import db from './database.js';
import dbRelatorios from './dbrelatorios.js'; // NOVO: Importa o especialista em relatórios

/**
 * Lida com todos os comandos enviados no grupo de administração.
 */
export async function processarComandoAdmin(msg, sock) {
    const jid = msg.key.remoteJid;
    const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
    if (!texto.startsWith('.')) return;

    const textoSemPrefixo = texto.slice(1);
    const [comando, ...args] = textoSemPrefixo.split(' ');
    const comandoLower = comando.toLowerCase();

    switch (comandoLower) {
        case 'novaconta':
            await criarNovaConta(args, jid, sock);
            break;

        case 'listarcontas':
            await listarContas(jid, sock);
            break;

        case 'comunicado':
            await enviarComunicadoParaContas(args, jid, sock);
            break;
        
        // --- LÓGICA CORRIGIDA ---
        case 'blackout':
            if (args.length < 2) return await sock.sendMessage(jid, { text: '⚠️ Formato: .blackout <numero> <horas>' });
            const [numero, horas] = args;
            if (!/^\d{12,13}$/.test(numero)) return await sock.sendMessage(jid, { text: '⚠️ Número inválido. Formato: 5531999998888' });
            const jidAlvo = `${numero}@s.whatsapp.net`;
            
            // ATUALIZADO: Chama a função diretamente do 'db'
            await db.adicionarBlackout(jidAlvo, parseFloat(horas));
            
            await sock.sendMessage(jid, { text: `✅ Blackout de ${horas}h aplicado para ${numero}.` });
            break;
        
        // --- LÓGICA CORRIGIDA ---
        case 'relatoriogeral':
            await gerarRelatorioGeral(args, jid, sock);
            break;

        default:
            await sock.sendMessage(jid, { text: `Comando de admin ".${comandoLower}" não reconhecido.\nDisponíveis: .novaconta, .listarcontas, .comunicado, .relatoriogeral, .blackout` });
            break;
    }
}

// ... (as funções criarNovaConta, listarContas e enviarComunicadoParaContas continuam as mesmas)

async function criarNovaConta(args, jidAdmin, sock) {
    if (args.length < 2) {
        return await sock.sendMessage(jidAdmin, { text: '⚠️ Formato: .novaconta <Nome do Negócio> <Número do Responsável com 55>' });
    }
    const numeroDono = args.pop();
    const nomeNegocio = args.join(' ');
    if (!/^\d{12,13}$/.test(numeroDono)) {
        return await sock.sendMessage(jidAdmin, { text: '⚠️ Número inválido. Use o formato: 5531999998888' });
    }
    const numeroDonoJid = `${numeroDono}@s.whatsapp.net`;
    try {
        await sock.sendMessage(jidAdmin, { text: `Iniciando criação da conta "${nomeNegocio}"...` });
        const contaExistente = await db.encontrarContaPorNumeroDono(numeroDono);
        if (contaExistente) {
            return await sock.sendMessage(jidAdmin, { text: `❌ O número ${numeroDono} já está associado à conta "${contaExistente.nome_do_bar}".` });
        }
        const nomeGrupo = `Gerenciamento - ${nomeNegocio}`;
        const novoGrupo = await sock.groupCreate(nomeGrupo, [numeroDonoJid]);
        await sock.sendMessage(jidAdmin, { text: `✅ Grupo "${nomeGrupo}" criado com sucesso!` });
        await db.adicionarConta({
            nome_do_bar: nomeNegocio,
            whatsapp_dono: numeroDono,
            grupo_id_whatsapp: novoGrupo.id,
            plano: 'gratuito',
            limite_fiado: 200
        });
        await sock.sendMessage(jidAdmin, { text: `✅ Conta para "${nomeNegocio}" salva no banco de dados!` });
        const mensagemBoasVindas = `Olá! 👋 Bem-vindo(a) ao *Receba Aí*!\n\nEste é o seu novo grupo de gerenciamento para o negócio *"${nomeNegocio}"*.\n\nUse este espaço para registrar suas vendas a prazo, controlar pagamentos e gerenciar seus clientes.\n\nPara começar, digite \`.ajuda\` e veja tudo que você pode fazer.\n\nBoas vendas! 🚀`;
        await sock.sendMessage(novoGrupo.id, { text: mensagemBoasVindas });
        await sock.sendMessage(jidAdmin, { text: `🚀 "${nomeNegocio}" está pronto para usar o sistema!` });
    } catch (error) {
        console.error("Erro ao criar nova conta:", error);
        await sock.sendMessage(jidAdmin, { text: `❌ Erro ao criar a conta "${nomeNegocio}".\nDetalhes: ${error.message}` });
    }
}

async function listarContas(jidAdmin, sock) {
    try {
        const contas = await db.listarContas();
        if (contas.length === 0) {
            return await sock.sendMessage(jidAdmin, { text: 'ℹ️ Nenhuma conta registrada no sistema.' });
        }
        let texto = '*Contas Registradas no Sistema* 📋\n\n';
        contas.forEach(conta => {
            texto += `- *${conta.nome_do_bar}*\n  Responsável: ${conta.whatsapp_dono}\n  Plano: ${conta.plano}\n  ID da Conta: \`${conta.id}\`\n\n`;
        });
        await sock.sendMessage(jidAdmin, { text: texto });
    } catch (error) {
        console.error("Erro ao listar contas:", error);
        await sock.sendMessage(jidAdmin, { text: `❌ Erro ao listar contas.\nDetalhes: ${error.message}` });
    }
}

async function enviarComunicadoParaContas(args, jidAdmin, sock) {
    if (args.length === 0) return await sock.sendMessage(jidAdmin, { text: '⚠️ Formato: .comunicado <sua mensagem aqui>' });
    const mensagem = args.join(' ');
    await sock.sendMessage(jidAdmin, { text: `📢 *Iniciando envio do comunicado.*\n\nMensagem:\n_"${mensagem}"_` });
    try {
        const contas = await db.listarContas();
        if (!contas || contas.length === 0) return await sock.sendMessage(jidAdmin, { text: 'ℹ️ Nenhuma conta encontrada.' });
        let enviados = 0, falhas = 0;
        await sock.sendMessage(jidAdmin, { text: `Iniciando envio para ${contas.length} contas...` });
        for (const conta of contas) {
            const numeroDono = conta.whatsapp_dono;
            if (!numeroDono) continue;
            try {
                await sock.sendMessage(`${numeroDono}@s.whatsapp.net`, { text: mensagem });
                enviados++;
                await new Promise(resolve => setTimeout(resolve, 1500));
            } catch (error) {
                falhas++;
                console.error(`Falha ao enviar para ${numeroDono}:`, error.message);
            }
        }
        const relatorioFinal = `*Relatório de Envio* 🚀\n- Sucessos: ${enviados}\n- Falhas: ${falhas}\n- Total: ${contas.length}`;
        await sock.sendMessage(jidAdmin, { text: relatorioFinal });
    } catch (error) {
        console.error('Erro ao buscar contas para comunicado:', error);
        await sock.sendMessage(jidAdmin, { text: '❌ Erro ao buscar a lista de contas no DB.' });
    }
}


/**
 * Gera um relatório geral de vendas de todas as contas.
 */
// --- FUNÇÃO CORRIGIDA ---
async function gerarRelatorioGeral(args, jidAdmin, sock) {
    try {
        // Define o período (mês/ano)
        const mesAno = args[0] || new Date().toISOString().slice(0, 7); // Formato AAAA-MM
        const [ano, mes] = mesAno.split('-').map(Number);
        const dataInicio = new Date(ano, mes - 1, 1);
        const dataFim = new Date(ano, mes, 1); // Pega até o início do próximo mês

        const contas = await db.listarContas();
        if (contas.length === 0) return await sock.sendMessage(jidAdmin, { text: 'ℹ️ Nenhuma conta registrada.' });

        let texto = `*Relatório Geral de Vendas - ${mes}/${ano}* 📊\n\n`;
        let totalGeralVendido = 0;
        let totalVendasGeral = 0;

        for (const conta of contas) {
            // Usa a função correta do dbrelatorios.js
            const vendas = await dbRelatorios.gerarRelatorioVendas(conta.id, dataInicio, dataFim);
            const vendasPositivas = vendas.filter(v => v.valor_total > 0);
            
            const totalVendasConta = vendasPositivas.reduce((sum, venda) => sum + venda.valor_total, 0);
            totalGeralVendido += totalVendasConta;
            totalVendasGeral += vendasPositivas.length;

            texto += `*${conta.nome_do_bar}*\n`;
            texto += `  - Faturamento: R$ ${totalVendasConta.toFixed(2)}\n`;
            texto += `  - Nº de Vendas: ${vendasPositivas.length}\n\n`;
        }
        texto += `*-- TOTAIS GERAIS --*\n`;
        texto += `*FATURAMENTO GERAL: R$ ${totalGeralVendido.toFixed(2)}*\n`;
        texto += `*Nº TOTAL DE VENDAS: ${totalVendasGeral}*`;
        
        await sock.sendMessage(jidAdmin, { text: texto });
    } catch (error) {
        console.error("Erro ao gerar relatório geral:", error);
        await sock.sendMessage(jidAdmin, { text: `❌ Erro ao gerar relatório geral.\nDetalhes: ${error.message}` });
    }
}
