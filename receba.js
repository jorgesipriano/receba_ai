import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import 'dotenv/config';
import pkg from './package.json' with { type: 'json' };
import db from './database.js';

import { iniciarAgendamentos } from './agendamentos.js';
import { processarComandoNegocio } from './logica_receba_ai.js';
import { processarComandoAdmin } from './administrator.js';
import { processarAtendimentoInicial } from './atendimento.js';
import { processarMensagemSuporte } from './suporte.js';

const SESSION_DIR = './auth_receba_ai';
const GRUPO_ADMIN = process.env.GRUPO_ADMIN;
const SOCIOS = ['553184484119@s.whatsapp.net', '553184698296@s.whatsapp.net'];
const BOT_VERSION = pkg.version || '2.0.0';
const RECONNECT_INTERVAL = 5000;
const HEALTH_CHECK_INTERVAL = 460000; // Aumentado para 1 minuto

// NOVO: URL do Webhook vinda do .env
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

let sock;

// --- NOVO: Sistema de Notificação via Discord ---
async function notificarDiscord(titulo, descricao, tipo = 'info') {
    if (!DISCORD_WEBHOOK_URL) {
        console.warn("DISCORD_WEBHOOK_URL não definido. Notificação pulada.");
        return;
    }

    const cores = {
        info: 3447003,    // Azul
        sucesso: 3066993,  // Verde
        alerta: 15105570, // Amarelo
        erro: 15158332    // Vermelho
    };

    const payload = {
        embeds: [{
            title: titulo,
            description: descricao,
            color: cores[tipo] || cores['info'],
            footer: {
                text: `Receba Aí Bot v${BOT_VERSION}`
            },
            timestamp: new Date().toISOString()
        }]
    };

    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        console.error("❌ Falha ao enviar notificação para o Discord:", error);
    }
}


// ALTERADO: Função de notificar sócios agora é usada apenas para casos específicos (suporte)
async function notificarSocios(mensagem) {
    console.warn(mensagem);
    for (const socioJid of SOCIOS) {
        try {
            await sock.sendMessage(socioJid, { text: mensagem });
        } catch (error) {
            console.error(`Falha ao notificar sócio ${socioJid}:`, error);
        }
    }
}

async function processarMensagemGeral(msg) {
    try {
        const jid = msg.key.remoteJid;
        if (msg.key.fromMe || !jid) return;

        if (jid === GRUPO_ADMIN) {
            return await processarComandoAdmin(msg, sock);
        }
        if (jid.endsWith('@g.us')) {
            const conta = await db.encontrarContaPorGrupoId(jid);
            if (conta) return await processarComandoNegocio(msg, sock);
        }
        if (jid.endsWith('@s.whatsapp.net')) {
            const numeroRemetente = jid.split('@')[0];
            const contaExistente = await db.encontrarContaPorNumeroDono(numeroRemetente);
            if (contaExistente) {
                // Aqui, o suporte pode usar a notificação via WhatsApp se precisar
                return await processarMensagemSuporte(msg, sock, contaExistente);
            } else {
                return await processarAtendimentoInicial(msg, sock);
            }
        }
    } catch (error) {
        console.error(`❌ Erro GERAL ao processar mensagem de ${msg.key.remoteJid}:`, error);
        // ALTERADO: Notificação de erro geral agora vai para o Discord
        await notificarDiscord('Erro Crítico no Processamento', `Ocorreu um erro inesperado ao processar uma mensagem. Verificar logs.\n\n*Detalhes:* ${error.message}`, 'erro');
    }
}

async function monitorarSaude() {
    setInterval(async () => {
        if (!sock || sock.ws.readyState !== 1) { // 1 = OPEN
            console.warn('Monitor de saúde detectou conexão inativa. O sistema de reconexão deve atuar.');
            return;
        }
        try {
            await sock.sendPresenceUpdate('available');
            console.log('✅ Health check (presence update) passado.');
        } catch (error) {
            console.error('❌ Falha no health check:', error);
            await notificarDiscord('Alerta de Saúde ⚠️', 'Falha detectada na conexão. A reconexão automática será tentada.', 'alerta');
            sock.end();
        }
    }, HEALTH_CHECK_INTERVAL);
}

async function startApp() {
    if (!GRUPO_ADMIN) {
        console.error('❌ ERRO FATAL: A variável GRUPO_ADMIN não está definida no .env');
        process.exit(1);
    }
    console.log(`🚀 Iniciando o Receba Aí v${BOT_VERSION}...`);
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['Receba Aí', 'Chrome', BOT_VERSION]
    });

    iniciarAgendamentos(sock);
    monitorarSaude();

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('✅ Bot Receba Aí conectado ao WhatsApp!');
            notificarDiscord('Bot Conectado', `O Bot Receba Aí v${BOT_VERSION} conectou com sucesso!`, 'sucesso');
        } else if (connection === 'close') {
            const motivo = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const motivoTexto = DisconnectReason[motivo] || `Código Desconhecido: ${motivo}`;
            console.log(`🔄 Conexão fechada: ${motivoTexto}`);
            
            if (motivo !== DisconnectReason.loggedOut) {
                notificarDiscord('Bot Desconectado', `Conexão fechada: ${motivoTexto}.\nTentando reconectar...`, 'alerta');
                setTimeout(startApp, RECONNECT_INTERVAL);
            } else {
                const erroMsg = 'CONEXÃO PERMANENTE PERDIDA (loggedOut). É necessário escanear o QR Code novamente.';
                console.error(`❌ ${erroMsg}`);
                notificarDiscord('Erro Fatal de Conexão', erroMsg, 'erro');
                process.exit(1);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        if (messages[0]?.message) {
            await processarMensagemGeral(messages[0]);
        }
    });
}

startApp().catch(async err => {
    console.error('❌ Erro fatal ao iniciar o bot:', err);
    await notificarDiscord('Erro Fatal na Inicialização', `O bot falhou ao iniciar. Verificar console/logs com urgência.\n\n*Detalhes:* ${err.message}`, 'erro');
    process.exit(1);
});
