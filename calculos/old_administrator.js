import db from './database.js';
import { setBlackout } from './suporte.js';

/**
 * Lida com todos os comandos enviados no grupo de administração.
 */
export async function processarComandoAdmin(msg, sock) {
    const jid = msg.key.remoteJid;
    const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
    if (!texto) return;

    // --- MUDANÇA AQUI: Adiciona a checagem por '.' ---
    if (!texto.startsWith('.')) {
        return; // Ignora mensagens que não são comandos
    }

    const textoSemPrefixo = texto.slice(1);
    const [comando, ...args] = textoSemPrefixo.split(' ');
    const comandoLower = comando.toLowerCase();

    switch (comandoLower) {
        case 'criarbar':
            await criarNovoBar(args, jid, sock);
            break;

        case 'blackout':
            if (args.length < 2) return await sock.sendMessage(jid, { text: '⚠️ Formato: .blackout <numero> <horas>' });
            const [numero, horas] = args;
            if (!/^\d{12,13}$/.test(numero)) return await sock.sendMessage(jid, { text: '⚠️ Número inválido. Formato: 5531999998888' });
            const jidAlvo = `${numero}@s.whatsapp.net`;
            setBlackout(jidAlvo, parseFloat(horas));
            await sock.sendMessage(jid, { text: `✅ Blackout de ${horas}h aplicado para ${numero}.` });
            break;

        case 'listarbars':
            await listarBares(jid, sock);
            break;

        case 'relatoriogeral':
            await gerarRelatorioGeral(args, jid, sock);
            break;

        case 'comunicado':
            await enviarComunicadoParaBares(args, jid, sock);
            break;

        default:
            await sock.sendMessage(jid, { text: `Comando ".${comandoLower}" não reconhecido.\nDisponíveis: .criarbar, .blackout, .listarbars, .relatoriogeral, .comunicado` });
            break;
    }
}


/**
 * Envia uma mensagem para todos os donos de bares cadastrados.
 */
async function enviarComunicadoParaBares(args, jidAdmin, sock) {
    if (args.length === 0) return await sock.sendMessage(jidAdmin, { text: '⚠️ Formato: .comunicado <sua mensagem aqui>' });
    const mensagem = args.join(' ');
    await sock.sendMessage(jidAdmin, { text: `📢 *Iniciando envio do comunicado para todos os bares.*\n\nMensagem:\n_"${mensagem}"_` });
    let contas;
    try {
        contas = await db.listarContas();
        if (!contas || contas.length === 0) return await sock.sendMessage(jidAdmin, { text: 'ℹ️ Nenhum bar encontrado para enviar comunicados.' });
    } catch (error) {
        console.error('Erro ao buscar contas:', error);
        return await sock.sendMessage(jidAdmin, { text: '❌ Erro ao buscar a lista de bares no banco de dados.' });
    }
    let enviados = 0;
    let falhas = 0;
    const total = contas.length;
    await sock.sendMessage(jidAdmin, { text: `Iniciando envio para ${total} bares. Isso pode levar um tempo...` });
    for (const [index, conta] of contas.entries()) {
        const numeroDono = conta.whatsapp_dono;
        if (!numeroDono) {
            console.log(`⚠️ Ignorando bar "${conta.nome_do_bar}" por não ter número.`);
            continue;
        }
        const jidDono = `${numeroDono}@s.whatsapp.net`;
        try {
            await sock.sendMessage(jidDono, { text: mensagem });
            enviados++;
            console.log(`Comunicado enviado para ${conta.nome_do_bar}`);
            await new Promise(resolve => setTimeout(resolve, 2500));
        } catch (error) {
            falhas++;
            console.error(`Falha ao enviar para ${jidDono}:`, error.message);
        }
        if ((index + 1) % 5 === 0 && (index + 1) < total) {
            await sock.sendMessage(jidAdmin, { text: `Progresso: ${index + 1}/${total} enviados...` });
        }
    }
    const relatorioFinal = `*Relatório de Envio de Comunicado* 🚀\n\n- Sucessos: ${enviados}\n- Falhas: ${falhas}\n- Total de Bares: ${total}`;
    await sock.sendMessage(jidAdmin, { text: relatorioFinal });
}


/**
 * Cria uma nova conta de bar, incluindo o grupo no WhatsApp.
 */
async function criarNovoBar(args, jidAdmin, sock) {
    if (args.length < 2) return await sock.sendMessage(jidAdmin, { text: '⚠️ Formato: .criarbar <Nome do Negócio> <Número do Dono com 55>' });
    const numeroDono = args.pop();
    const nomeNegocio = args.join(' ');
    if (!/^\d{12,13}$/.test(numeroDono)) return await sock.sendMessage(jidAdmin, { text: '⚠️ Número inválido. Use o formato: 5531999998888' });
    const numeroDonoJid = `${numeroDono}@s.whatsapp.net`;
    try {
        await sock.sendMessage(jidAdmin, { text: `Iniciando criação da conta "${nomeNegocio}"...` });
        const contaExistente = await db.encontrarContaPorNumeroDono(numeroDono);
        if (contaExistente) return await sock.sendMessage(jidAdmin, { text: `❌ O número ${numeroDono} já está associado à conta "${contaExistente.nome_do_bar}".` });
        const nomeGrupo = `Gerenciamento - ${nomeNegocio}`;
        const novoGrupo = await sock.groupCreate(nomeGrupo, [numeroDonoJid]);
        console.log(`Grupo criado: ${novoGrupo.id} para ${nomeNegocio}`);
        await sock.groupSettingUpdate(novoGrupo.id, 'announcement');
        await sock.sendMessage(jidAdmin, { text: `✅ Grupo "${nomeGrupo}" criado com sucesso!` });
        await db.adicionarConta({
            nome_do_bar: nomeNegocio, whatsapp_dono: numeroDono, grupo_id_whatsapp: novoGrupo.id, plano: 'gratuito', limite_fiado: 200
        });
        await sock.sendMessage(jidAdmin, { text: `✅ Conta para "${nomeNegocio}" salva no banco de dados!` });
        const mensagemBoasVindas = `Olá! Bem-vindo ao seu novo grupo de gerenciamento para *${nomeNegocio}*! 🍻\n\nPara começar, digite *.ajuda* e veja todos os comandos disponíveis.`;
        await sock.sendMessage(novoGrupo.id, { text: mensagemBoasVindas });
        await sock.sendMessage(jidAdmin, { text: `🚀 "${nomeNegocio}" está pronto para usar o sistema!` });
    } catch (error) {
        console.error("Erro ao criar nova conta:", error);
        await sock.sendMessage(jidAdmin, { text: `❌ Erro ao criar a conta "${nomeNegocio}".\nDetalhes: ${error.message}` });
    }
}

/**
 * Lista todos os bares registrados.
 */
async function listarBares(jidAdmin, sock) {
    try {
        const contas = await db.listarContas();
        if (contas.length === 0) return await sock.sendMessage(jidAdmin, { text: 'ℹ️ Nenhuma conta registrada.' });
        let texto = '*Contas Registradas* 📋\n\n';
        contas.forEach(conta => {
            texto += `- *${conta.nome_do_bar}*\n  Dono: ${conta.whatsapp_dono}\n  Grupo: ${conta.grupo_id_whatsapp}\n  Plano: ${conta.plano}\n  ID da Conta: \`${conta.id}\`\n\n`;
        });
        await sock.sendMessage(jidAdmin, { text: texto });
    } catch (error) {
        console.error("Erro ao listar contas:", error);
        await sock.sendMessage(jidAdmin, { text: `❌ Erro ao listar contas.\nDetalhes: ${error.message}` });
    }
}

/**
 * Gera um relatório geral de vendas de todos os bares.
 */
async function gerarRelatorioGeral(args, jidAdmin, sock) {
    try {
        const mesAno = args[0] || new Date().toISOString().slice(0, 7);
        const contas = await db.listarContas();
        if (contas.length === 0) return await sock.sendMessage(jidAdmin, { text: 'ℹ️ Nenhuma conta registrada.' });
        let texto = `*Relatório Geral de Vendas - ${mesAno}* 📊\n\n`;
        let totalGeralVendido = 0;
        for (const conta of contas) {
            const vendas = await db.gerarRelatorioVendasPorConta(conta.id, mesAno);
            const totalVendas = vendas.reduce((sum, venda) => sum + venda.valor_total, 0);
            totalGeralVendido += totalVendas;
            texto += `*${conta.nome_do_bar}*\n`;
            texto += `  - Total de Vendas: R$ ${totalVendas.toFixed(2)}\n`;
            texto += `  - Nº de Vendas: ${vendas.length}\n\n`;
        }
        texto += `*TOTAL GERAL VENDIDO (TODAS AS CONTAS): R$ ${totalGeralVendido.toFixed(2)}*`;
        await sock.sendMessage(jidAdmin, { text: texto });
    } catch (error) {
        console.error("Erro ao gerar relatório geral:", error);
        await sock.sendMessage(jidAdmin, { text: `❌ Erro ao gerar relatório geral.\nDetalhes: ${error.message}` });
    }
}
