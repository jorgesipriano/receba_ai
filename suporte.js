// suporte.js
const SOCIOS = ['553184484119@s.whatsapp.net', '553184698296@s.whatsapp.net'];
let estadosSuporte = {}; // JID -> { etapa, dados }

const MENU_SUPORTE = `*Assistente de Suporte Receba Aí* 🛠️

Olá! Vi que você já é nosso cliente. Como posso ajudar hoje?

*Responda com o número da sua necessidade:*
1️⃣ - Tive um problema com o bot
2️⃣ - Quero dar uma sugestão
3️⃣ - Falar com o financeiro/administrativo`;

const MENU_PROBLEMAS = `*Qual o tipo de problema?*

1️⃣ - O bot não está respondendo no meu grupo.
2️⃣ - Um comando não funcionou como esperado.`;

// --- FUNÇÃO AUXILIAR MOVİDA PARA FORA ---
async function notificarSocios(sock, mensagem) {
    for (const socioJid of SOCIOS) {
        try {
            await sock.sendMessage(socioJid, { text: mensagem });
        } catch (error) {
            console.error(`Falha ao notificar sócio ${socioJid}`, error);
        }
    }
}

export async function processarMensagemSuporte(msg, sock, conta) {
    const jid = msg.key.remoteJid;
    const texto = (msg.message?.conversation || '').trim();
    const estado = estadosSuporte[jid]?.etapa;

    if (!estado) {
        await sock.sendMessage(jid, { text: MENU_SUPORTE });
        estadosSuporte[jid] = { etapa: 'aguardando_opcao_inicial' };
        return;
    }

    if (estado === 'aguardando_opcao_inicial') {
        if (texto === '1') {
            await sock.sendMessage(jid, { text: MENU_PROBLEMAS });
            estadosSuporte[jid].etapa = 'aguardando_tipo_problema';
        } else if (texto === '2') {
            await sock.sendMessage(jid, { text: 'Ótimo! Por favor, descreva sua sugestão. Sua ideia é muito importante para nós! 💡' });
            estadosSuporte[jid].etapa = 'aguardando_sugestao';
        } else if (texto === '3') {
            await notificarSocios(sock, `*Contato Financeiro/Admin*\n\n- *Cliente:* ${conta.nome_do_bar}\n- *Responsável:* ${jid.split('@')[0]}\n\nEntrar em contato para resolver questões administrativas.`);
            await sock.sendMessage(jid, { text: '✅ Sua solicitação foi enviada. O setor administrativo/financeiro entrará em contato em breve.' });
            delete estadosSuporte[jid];
        } else {
            await sock.sendMessage(jid, { text: 'Opção inválida. Por favor, responda com 1, 2 ou 3.' });
        }
        return;
    }

    if (estado === 'aguardando_tipo_problema') {
        if (texto === '1') {
            await notificarSocios(sock, `*ALERTA: Bot Parado* 🛑\n\n- *Cliente:* ${conta.nome_do_bar} (${conta.grupo_id_whatsapp})\n- *Responsável:* ${jid.split('@')[0]}\n\nO cliente reportou que o bot não está respondendo no grupo. *Verificar com urgência!*`);
            await sock.sendMessage(jid, { text: '🚨 *Obrigado por avisar!* Nossa equipe técnica já foi notificada e está verificando o que aconteceu. Pedimos desculpas pelo transtorno.' });
            delete estadosSuporte[jid];
        } else if (texto === '2') {
            await sock.sendMessage(jid, { text: 'Entendido. Por favor, descreva o problema com o comando: qual comando você usou e o que aconteceu de errado?' });
            estadosSuporte[jid].etapa = 'aguardando_descricao_problema';
        } else {
            await sock.sendMessage(jid, { text: 'Opção inválida. Responda com 1 ou 2.' });
        }
        return;
    }

    if (estado === 'aguardando_descricao_problema' || estado === 'aguardando_sugestao') {
        const tipo = estado === 'aguardando_sugestao' ? 'Sugestão' : 'Problema com Comando';
        await notificarSocios(sock, `*Nova Solicitação de Suporte: ${tipo}* 🙋‍♂️\n\n- *Cliente:* ${conta.nome_do_bar}\n- *Responsável:* ${jid.split('@')[0]}\n\n*Mensagem:*\n"${texto}"`);
        await sock.sendMessage(jid, { text: '✅ Obrigado pelo seu feedback! Sua mensagem foi registrada e enviada para nossa equipe.' });
        delete estadosSuporte[jid];
    }
}
