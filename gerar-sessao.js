// gerar-sessao.js (versão final com reconexão automática)

import baileys from '@whiskeysockets/baileys';
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;

import crypto from 'crypto'; // mantém o import se for usado em outro lugar, mas não sobrescreva global
import qrcode from 'qrcode-terminal';
import fs from 'fs';

const SESSAO_DIR = './auth_barpay';

// Função principal que pode ser chamada novamente para reconectar
async function conectarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSAO_DIR);

    const sock = makeWASocket({
        auth: state,
        browser: ['GeradorDeSessao', 'Chrome', '1.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n============================================');
            console.log('📱 Escaneie o QR Code abaixo com seu WhatsApp:');
            qrcode.generate(qr, { small: true });
            console.log('============================================\n');
        }

        if (connection === 'open') {
            console.log('\n============================================');
            console.log('✅ CONECTADO COM SUCESSO!');
            console.log('A pasta "auth_josy" foi criada e está pronta.');
            console.log('Você já pode fechar este script (pressione Ctrl+C).');
            console.log('============================================\n');
        }

        if (connection === 'close') {
            const motivo = lastDisconnect?.error?.output?.statusCode;

            // LÓGICA DE RECONEXÃO
            if (motivo === DisconnectReason.restartRequired) {
                console.log('🔄 Reinicialização necessária. Reconectando automaticamente...');
                conectarWhatsApp(); // Chama a si mesmo para reconectar
            } else if (motivo === DisconnectReason.loggedOut) {
                console.error('❌ Desconectado permanentemente. Remova a pasta "auth_josy" e execute o script novamente.');
            } else {
                console.log('Conexão fechada. Motivo:', motivo);
            }
        }
    });
}

// Início do script
console.log('Iniciando a geração de uma nova sessão...');

// Limpa a pasta da sessão antiga APENAS UMA VEZ, no início.
if (fs.existsSync(SESSAO_DIR)) {
    fs.rmSync(SESSAO_DIR, { recursive: true, force: true });
    console.log('Pasta de sessão antiga removida para garantir um novo QR Code.');
}

// Inicia a primeira tentativa de conexão
conectarWhatsApp();
