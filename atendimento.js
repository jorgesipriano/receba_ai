// atendimento.js
const GRUPO_ADMIN = process.env.GRUPO_ADMIN;

let estadosAtendimento = {}; // Simples controle de estado para não sobrecarregar novos contatos

const MENSAGEM_INICIAL = `Olá! 👋 Sou o assistente virtual do *Receba Aí*.

Vi que você é novo por aqui! Nosso sistema ajuda pequenos negócios a controlar suas vendas a prazo (o famoso "fiado") de forma simples e automatizada, direto pelo WhatsApp.

*Como funciona?*
1️⃣ Criamos um grupo privado no WhatsApp para você e o bot.
2️⃣ Você registra vendas com mensagens simples como: \`Maria 2 refri 5\`
3️⃣ O bot calcula a dívida, gera extratos, lembretes e muito mais!

Gostaria de saber mais ou testar gratuitamente?
*Responda 'sim' para falar com um de nossos consultores.*`;

export async function processarAtendimentoInicial(msg, sock) {
    const jid = msg.key.remoteJid;
    const nomeContato = msg.pushName || 'Novo Contato';
    const texto = (msg.message?.conversation || '').toLowerCase();

    // Se for o primeiro contato, envia a mensagem inicial
    if (!estadosAtendimento[jid]) {
        await sock.sendMessage(jid, { text: MENSAGEM_INICIAL });
        estadosAtendimento[jid] = 'aguardando_interesse';
        return;
    }

    // Se respondeu 'sim', notifica o grupo de admin
    if (texto === 'sim' && estadosAtendimento[jid] === 'aguardando_interesse') {
        const mensagemAdmin = `🔔 *Novo Lead Interessado!* 🔔\n\n- *Contato:* ${nomeContato}\n- *Número:* ${jid.split('@')[0]}\n\nPor favor, um consultor deve entrar em contato o mais rápido possível.`;
        
        await sock.sendMessage(GRUPO_ADMIN, { text: mensagemAdmin });
        await sock.sendMessage(jid, { text: `Ótimo! 👍 Um de nossos consultores entrará em contato com você em breve para tirar todas as suas dúvidas. Obrigado!` });
        
        // Finaliza o atendimento automático para este usuário
        delete estadosAtendimento[jid];
    }
}
