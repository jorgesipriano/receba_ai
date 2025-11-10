import db from './database.js';
import { setBlackout } from './suporte.js';

/**
 * Lida com todos os comandos enviados no grupo de administração.
 * @param {object} msg - O objeto da mensagem do Baileys.
 * @param {object} sock - A instância da conexão Baileys (para criar grupos, enviar msgs).
 */
export async function processarComandoAdmin(msg, sock) {
    const jid = msg.key.remoteJid;
    const texto = (msg.message?.conversation || '').trim();
    const [comando, ...args] = texto.split(' ');

    switch (comando.toLowerCase()) {
        case '/criarbar':
            await criarNovoBar(args, jid, sock);
            break;

        case '/blackout':
            if (args.length < 2) {
                await sock.sendMessage(jid, { text: '⚠️ Formato incorreto!\nUse: /blackout <numero> <horas>' });
                return;
            }
            const [numero, horas] = args;
            const jidAlvo = `${numero}@s.whatsapp.net`;
            setBlackout(jidAlvo, parseFloat(horas));
            await sock.sendMessage(jid, { text: `✅ Blackout de ${horas}h aplicado para o número ${numero}.` });
            break;

        // Este é o único 'default' no switch
        default:
            await sock.sendMessage(jid, { text: `Comando de admin "${comando}" não reconhecido.` });
            break;
    }
}

/**
 * Função para criar uma nova conta de bar, incluindo o grupo do WhatsApp.
 * @param {string[]} args - Argumentos do comando. Ex: ['Bar', 'do', 'Zé', '5531999998888']
 * @param {string} jidAdmin - O JID do grupo de admin, para enviar respostas.
 * @param {object} sock - A instância da conexão Baileys.
 */
async function criarNovoBar(args, jidAdmin, sock) {
    if (args.length < 2) {
        await sock.sendMessage(jidAdmin, { text: '⚠️ Formato incorreto!\nUse: /criarbar <Nome do Bar> <Número do Dono com 55>' });
        return;
    }

    const numeroDono = args.pop();
    const nomeBar = args.join(' ');
    const numeroDonoJid = `${numeroDono}@s.whatsapp.net`;

    try {
        await sock.sendMessage(jidAdmin, { text: `Iniciando criação do bar "${nomeBar}"...` });

        // 1. Cria o grupo no WhatsApp com o dono do bar
        const nomeGrupo = `Gerenciamento - ${nomeBar}`;
        const novoGrupo = await sock.groupCreate(nomeGrupo, [numeroDonoJid]);
        console.log(`Grupo criado: ${novoGrupo.id} para ${nomeBar}`);
        await sock.sendMessage(jidAdmin, { text: `✅ Grupo "${nomeGrupo}" criado com sucesso!` });

        // 2. Adiciona a nova conta no banco de dados (esta função precisa existir no database.js)
        await db.adicionarConta({
            nome_do_bar: nomeBar,
            whatsapp_dono: numeroDono,
            grupo_id_whatsapp: novoGrupo.id,
            plano: 'gratuito'
        });
        await sock.sendMessage(jidAdmin, { text: `✅ Conta para "${nomeBar}" salva no banco de dados!` });

        // 3. Envia uma mensagem de boas-vindas no NOVO grupo
        const mensagemBoasVindas = `Olá! Bem-vindo ao Cobranças.Bar, ${nomeBar}!\n\nEste grupo será seu painel de controle. Use o comando */ajuda* para ver tudo que você pode fazer.`;
        
        await sock.sendMessage(novoGrupo.id, { text: mensagemBoasVindas });

        await sock.sendMessage(jidAdmin, { text: `🚀 Processo finalizado! O "${nomeBar}" está pronto para usar o sistema.` });

    } catch (error) {
        console.error("Erro ao criar novo bar:", error);
        await sock.sendMessage(jidAdmin, { text: `❌ Ops, ocorreu um erro ao criar o bar "${nomeBar}".\nDetalhes: ${error.message}` });
    }
}
