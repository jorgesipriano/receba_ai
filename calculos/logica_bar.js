import db from './database.js';

/**
 * Normaliza uma string, removendo acentos e convertendo para minúsculas.
 */
function normalizarString(texto) {
    if (!texto) return '';
    return texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

/**
 * Analisa uma string de pedido e extrai os itens.
 */
function analisarItensDoPedido(textoDoPedido) {
    const palavras = textoDoPedido.trim().split(/\s+/);
    const itens = [];
    let i = 0;
    while (i < palavras.length) {
        const quantidade = parseFloat(palavras[i]);
        if (isNaN(quantidade) || quantidade <= 0) { i++; continue; }
        i++;
        let nomePartes = [];
        while (i < palavras.length && isNaN(parseFloat(palavras[i]))) {
            nomePartes.push(palavras[i]);
            i++;
        }
        if (nomePartes.length === 0) continue;
        const nomeProduto = nomePartes.join(' ');
        let valorUnitario = 0;
        if (i < palavras.length && !isNaN(parseFloat(palavras[i]))) {
            valorUnitario = parseFloat(palavras[i]);
            i++;
        }
        const valorTotal = quantidade * valorUnitario;
        itens.push({
            quantidade, descricaoProduto: nomeProduto, valorTotal: valorTotal, valorUnitario: valorUnitario
        });
    }
    return itens;
}

/**
 * Lida com os resultados da busca inteligente por clientes.
 */
async function handleClientSearchResult(sock, jid, searchResult, clientName) {
    if (searchResult.success) {
        return searchResult.cliente;
    }
    if (searchResult.reason === 'needs_correction') {
        const nomeSimilar = searchResult.similarClient.nome;
        let mensagem = `🤔 Cliente não encontrado pela busca rápida.\n\n`;
        mensagem += `Detectei um cliente com nome parecido (*${nomeSimilar}*) que pode estar com os dados de busca desatualizados.\n\n`;
        mensagem += `Para corrigir, por favor, use o comando:\n\`.corrigir cliente ${nomeSimilar}\``;
        await sock.sendMessage(jid, { text: mensagem });
        return null;
    }
    await sock.sendMessage(jid, { text: `🤔 Cliente "${clientName}" realmente não foi encontrado. Use .novo para cadastrá-lo.` });
    return null;
}

// Variável para guardar operações que precisam de confirmação.
let operacoesPendentes = {};

/**
 * A função principal que lida com os comandos do dono do bar.
 */
export async function processarComandoBar(msg, sock) {
    const jid = msg.key.remoteJid;
    const conta = await db.encontrarContaPorGrupoId(jid);
    if (!conta) return;
    const contaId = conta.id;
    const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
    if (!texto) return;

    if (texto.startsWith('.')) {
        const textoLimpo = texto.slice(1).replace(/\s+/g, ' ').trim();
        const args = textoLimpo.split(' ');
        let comando = args[0].toLowerCase();
        let restoDoTexto = args.slice(1).join(' ');

        if (args.length > 1) {
            const duasPalavras = `${args[0]} ${args[1]}`.toLowerCase();
            const comandosDuplos = [
                'alterar nome', 'excluir cliente', 'relatorio dia', 'total fiado', 
                'maiores dividas', 'melhores clientes', 'mais vendidos', 'limite fiado', 
                'corrigir cliente', 'unificar clientes', 'confirmar unificacao'
            ];
            if (comandosDuplos.includes(duasPalavras)) {
                comando = duasPalavras;
                restoDoTexto = args.slice(2).join(' ');
            }
        }

        if (comando === 'novo') {
            const palavrasIgnoradas = ['cliente', 'novo', 'nome'];
            let nomeArgs = restoDoTexto.split(' ').filter(p => p);
            while (nomeArgs.length > 0 && palavrasIgnoradas.includes(nomeArgs[0].toLowerCase())) {
                nomeArgs.shift();
            }
            const nomeNovoCliente = nomeArgs.join(' ');
            if (!nomeNovoCliente) return await sock.sendMessage(jid, { text: '⚠️ Formato: .novo <nome do cliente>' });
            const resultado = await db.adicionarCliente(nomeNovoCliente, contaId);
            if (resultado.success) {
                await sock.sendMessage(jid, { text: resultado.message });
            } else if (resultado.reason === 'duplicate') {
                const nomeExistente = resultado.existingClient.nome;
                let mensagem = `⚠️ *Atenção!* Um cliente chamado "*${nomeExistente}*" já está cadastrado.\n\n`;
                mensagem += `Para adicionar vendas para ele, continue normalmente:\n\`${nomeExistente} 1 Cerveja 10\`\n\n`;
                mensagem += `Se esta for uma pessoa diferente, use um nome mais específico. Exemplo:\n\`.novo ${nomeExistente} (sobrinho)\``;
                await sock.sendMessage(jid, { text: mensagem });
            }
        } else if (comando === 'somar') {
            const nomesParaSomar = restoDoTexto.split('+');
            if (nomesParaSomar.length < 2) return await sock.sendMessage(jid, { text: '⚠️ Formato: .somar <nome1> + <nome2> + ...' });
            let totalGeral = 0;
            let resumoDetalhado = '*Soma de Dívidas* ➕\n\n';
            let naoEncontrados = [];
            for (const nome of nomesParaSomar) {
                const nomeTrimmed = nome.trim();
                if (!nomeTrimmed) continue;
                const resultadoBusca = await db.encontrarClienteOuSugerirCorrecao(nomeTrimmed, contaId);
                if (resultadoBusca.success) {
                    const cliente = resultadoBusca.cliente;
                    const divida = await db.calcularDividaTotal(cliente.id, contaId);
                    totalGeral += divida;
                    resumoDetalhado += `- ${cliente.nome}: R$ ${divida.toFixed(2)}\n`;
                } else {
                    naoEncontrados.push(nomeTrimmed);
                }
            }
            resumoDetalhado += `\n*TOTAL COMBINADO: R$ ${totalGeral.toFixed(2)}*`;
            if (naoEncontrados.length > 0) {
                resumoDetalhado += `\n\n⚠️ *Atenção:* Os seguintes nomes não foram encontrados: ${naoEncontrados.join(', ')}`;
            }
            await sock.sendMessage(jid, { text: resumoDetalhado });
        } else if (comando === 'unificar clientes') {
            const nomeParaUnificar = restoDoTexto;
            if (!nomeParaUnificar) return await sock.sendMessage(jid, { text: '⚠️ Formato: .unificar clientes <nome>' });
            const analise = await db.analisarDuplicatas(nomeParaUnificar, contaId);
            if (!analise.duplicatasEncontradas) return await sock.sendMessage(jid, { text: `✅ Não encontrei clientes duplicados para "${nomeParaUnificar}".` });
            let resposta = `*Análise de Clientes Duplicados* 🧐\n\n`;
            resposta += `Encontrei *${analise.clientes.length}* registros para o nome "*${nomeParaUnificar}*":\n`;
            analise.clientes.forEach(c => {
                resposta += `- ${c.nome}\n`;
            });
            resposta += `\nA dívida total combinada de todos eles é: *R$ ${analise.dividaTotalCombinada.toFixed(2)}*\n\n`;
            resposta += `🚨 *ATENÇÃO:* Esta ação não pode ser desfeita.\n`;
            resposta += `Para confirmar e unificar todos em um único cliente chamado "*${nomeParaUnificar}*", envie o comando:\n\n`;
            resposta += `\`.confirmar unificacao ${nomeParaUnificar}\``;
            operacoesPendentes[jid] = { tipo: 'unificacao', nome: nomeParaUnificar, clientes: analise.clientes, expiraEm: Date.now() + 5 * 60 * 1000 };
            await sock.sendMessage(jid, { text: resposta });
        } else if (comando === 'confirmar unificacao') {
            const nomeParaConfirmar = restoDoTexto;
            const pendente = operacoesPendentes[jid];
            const nomeNormalizadoPendente = normalizarString(pendente?.nome);
            const nomeNormalizadoConfirmar = normalizarString(nomeParaConfirmar);
            if (!pendente || pendente.tipo !== 'unificacao' || Date.now() > pendente.expiraEm) {
                return await sock.sendMessage(jid, { text: '❌ Nenhuma operação de unificação pendente ou ela já expirou. Comece novamente com `.unificar clientes`.' });
            }
            if (nomeNormalizadoConfirmar !== nomeNormalizadoPendente) {
                return await sock.sendMessage(jid, { text: `❌ O nome não corresponde à unificação pendente. Operação pendente é para "${pendente.nome}".` });
            }
            await sock.sendMessage(jid, { text: '🔄 Confirmado! Iniciando unificação... Isso pode levar um momento.' });
            try {
                const resultado = await db.executarUnificacao(pendente.clientes, pendente.nome, contaId);
                const dividaFinal = await db.calcularDividaTotal(resultado.clienteFinal.id, contaId);
                let respostaFinal = `✅ *Unificação Concluída!* ✅\n\n`;
                respostaFinal += `Todos os registros duplicados foram unificados no cliente "*${resultado.clienteFinal.nome}*".\n`;
                respostaFinal += `A dívida total dele agora é: *R$ ${dividaFinal.toFixed(2)}*.`;
                await sock.sendMessage(jid, { text: respostaFinal });
            } catch (error) {
                console.error("Erro ao executar unificação:", error);
                await sock.sendMessage(jid, { text: `❌ Ocorreu um erro grave durante a unificação.` });
            } finally {
                delete operacoesPendentes[jid];
            }
        } else if (comando === 'corrigir cliente') {
            const nomeParaCorrigir = restoDoTexto;
            if (!nomeParaCorrigir) return await sock.sendMessage(jid, { text: '⚠️ Formato: .corrigir cliente <nome do cliente>' });
            const resultado = await db.corrigirCliente(nomeParaCorrigir, contaId);
            await sock.sendMessage(jid, { text: resultado.message });
        } else if (comando === 'clientes') {
            const clientes = await db.listarTodosClientes(contaId);
            if (clientes.length === 0) return await sock.sendMessage(jid, { text: 'Você ainda não cadastrou nenhum cliente.' });
            let listaClientes = '*Lista de Clientes com Dívidas:*\n\n';
            let temDividas = false;
            for (const cliente of clientes) {
                const divida = await db.calcularDividaTotal(cliente.id, contaId);
                if (divida > 0) {
                    listaClientes += `- ${cliente.nome} (Dívida: R$ ${divida.toFixed(2)})\n`;
                    temDividas = true;
                }
            }
            if (!temDividas) {
                listaClientes = '🎉 Nenhum cliente com dívidas pendentes no momento!';
            }
            await sock.sendMessage(jid, { text: listaClientes });
        } else if (comando === 'alterar nome') {
            const partes = restoDoTexto.split('-');
            if (partes.length !== 2) return await sock.sendMessage(jid, { text: '⚠️ Formato: .alterar nome <Nome Antigo> - <Nome Novo>' });
            const nomeAntigo = partes[0].trim();
            const nomeNovo = partes[1].trim();
            const resultadoBusca = await db.encontrarClienteOuSugerirCorrecao(nomeAntigo, contaId);
            const clienteParaAlterar = await handleClientSearchResult(sock, jid, resultadoBusca, nomeAntigo);
            if (!clienteParaAlterar) return;
            await db.alterarNomeCliente(clienteParaAlterar.id, nomeNovo, contaId);
            await sock.sendMessage(jid, { text: `✅ O nome do cliente foi alterado de "${nomeAntigo}" para "${nomeNovo}".` });
        } else if (comando === 'excluir cliente') {
            const nomeParaExcluir = restoDoTexto;
            if (!nomeParaExcluir) return await sock.sendMessage(jid, { text: '⚠️ Formato: .excluir cliente <nome>' });
            const resultadoBusca = await db.encontrarClienteOuSugerirCorrecao(nomeParaExcluir, contaId);
            const clienteParaExcluir = await handleClientSearchResult(sock, jid, resultadoBusca, nomeParaExcluir);
            if (!clienteParaExcluir) return;
            await db.excluirCliente(clienteParaExcluir.id, contaId);
            await sock.sendMessage(jid, { text: `🗑️ Cliente "${clienteParaExcluir.nome}" e suas vendas foram excluídos.` });
        } else if (comando === 'extrato') {
            const nomeExtrato = restoDoTexto;
            if (!nomeExtrato) return await sock.sendMessage(jid, { text: '⚠️ Formato: .extrato <nome do cliente>' });
            const resultadoBusca = await db.encontrarClienteOuSugerirCorrecao(nomeExtrato, contaId);
            const clienteExtrato = await handleClientSearchResult(sock, jid, resultadoBusca, nomeExtrato);
            if (!clienteExtrato) return;
            const extrato = await db.gerarExtrato(clienteExtrato.id, contaId);
            if (extrato.length === 0) return await sock.sendMessage(jid, { text: `✅ *${clienteExtrato.nome}* não possui dívidas pendentes.` });
            let textoExtrato = `*Extrato de Dívidas de ${clienteExtrato.nome}*\n\n`;
            let totalDividaExtrato = 0;
            extrato.forEach(item => {
                totalDividaExtrato += item.valor_total;
                const dataItem = new Date(item.created_at).toLocaleDateString('pt-BR');
                if (item.valor_total < 0) {
                    textoExtrato += `${dataItem} - ${item.descricao_produto} - Crédito de R$ ${(-item.valor_total).toFixed(2)}\n`;
                } else {
                    textoExtrato += `${dataItem} - ${item.quantidade}x ${item.descricao_produto} - R$ ${item.valor_total.toFixed(2)}\n`;
                }
            });
            textoExtrato += `\n*SALDO DEVEDOR: R$ ${totalDividaExtrato.toFixed(2)}*`;
            await sock.sendMessage(jid, { text: textoExtrato });
        } else if (comando === 'divida') {
            const nomeDivida = restoDoTexto;
            if (!nomeDivida) return await sock.sendMessage(jid, { text: '⚠️ Formato: .divida <nome do cliente>' });
            const resultadoBusca = await db.encontrarClienteOuSugerirCorrecao(nomeDivida, contaId);
            const clienteDivida = await handleClientSearchResult(sock, jid, resultadoBusca, nomeDivida);
            if (!clienteDivida) return;
            const total = await db.calcularDividaTotal(clienteDivida.id, contaId);
            await sock.sendMessage(jid, { text: `A dívida atual de *${clienteDivida.nome}* é de *R$ ${total.toFixed(2)}*.` });
        } else if (comando === 'pago') {
            const argsPago = restoDoTexto.split(' ').filter(p => p);
            if (argsPago.length === 0) return await sock.sendMessage(jid, { text: '⚠️ Formato: .pago <nome> [valor]' });
            let valorPago = null;
            let nomeArgs = [];
            const valorString = argsPago.find(arg => !isNaN(parseFloat(arg.replace(',', '.'))));
            if (valorString) {
                const valorEncontrado = parseFloat(valorString.replace(',', '.'));
                if (valorEncontrado > 0) {
                    valorPago = valorEncontrado;
                    nomeArgs = argsPago.filter(arg => arg !== valorString);
                } else {
                    nomeArgs = argsPago;
                }
            } else {
                nomeArgs = argsPago;
            }
            const nomeCliente = nomeArgs.join(' ');
            if (!nomeCliente) return await sock.sendMessage(jid, { text: '⚠️ Nome do cliente não fornecido.' });
            const resultadoBusca = await db.encontrarClienteOuSugerirCorrecao(nomeCliente, contaId);
            const cliente = await handleClientSearchResult(sock, jid, resultadoBusca, nomeCliente);
            if (!cliente) return;
            if (valorPago) {
                await db.adicionarVenda({ clienteId: cliente.id, contaId: contaId, descricaoProduto: '--- PAGAMENTO / ABATIMENTO ---', quantidade: 1, valorUnitario: -valorPago, valorTotal: -valorPago });
                const dividaRestante = await db.calcularDividaTotal(cliente.id, contaId);
                await sock.sendMessage(jid, { text: `✅ Pagamento de *R$ ${valorPago.toFixed(2)}* registrado para *${cliente.nome}*.\n\nSua dívida restante agora é de: *R$ ${dividaRestante.toFixed(2)}*` });
            } else {
                const dividaTotal = await db.calcularDividaTotal(cliente.id, contaId);
                if (dividaTotal <= 0) return await sock.sendMessage(jid, { text: `ℹ️ *${cliente.nome}* já está com a conta em dia.` });
                const quitadoComSucesso = await db.quitarDivida(cliente.id, contaId);
                if (quitadoComSucesso) {
                    await sock.sendMessage(jid, { text: `✅ Pagamento total recebido! A dívida de *${cliente.nome}* no valor de *R$ ${dividaTotal.toFixed(2)}* foi quitada com sucesso.` });
                } else {
                    await sock.sendMessage(jid, { text: `❌ Ocorreu um erro ao quitar a dívida de *${cliente.nome}*.` });
                }
            }
        } else if (comando === 'relatorio dia' || comando === 'relatoriodia') {
            const hojeFiltro = new Date();
            const inicioDoDia = new Date(hojeFiltro.getFullYear(), hojeFiltro.getMonth(), hojeFiltro.getDate(), 0, 0, 0, 0);
            const fimDoDia = new Date(hojeFiltro.getFullYear(), hojeFiltro.getMonth(), hojeFiltro.getDate(), 23, 59, 59, 999);
            const vendasDia = await db.gerarRelatorioVendas(contaId, inicioDoDia, fimDoDia);
            if (vendasDia.length === 0) return await sock.sendMessage(jid, { text: `Nenhuma venda ou pagamento registrado hoje.` });
            let textoRelatorio = `*Relatório de Hoje*\n\n`;
            const vendasReais = vendasDia.filter(v => v.valor_total > 0);
            const pagamentos = vendasDia.filter(v => v.valor_total < 0);
            let totalVendido = vendasReais.reduce((acc, v) => acc + v.valor_total, 0);
            let totalPago = pagamentos.reduce((acc, p) => acc + p.valor_total, 0);
            vendasReais.forEach(v => {
                textoRelatorio += `- ${v.cliente_nome}: ${v.quantidade}x ${v.descricao_produto} (R$ ${v.valor_total.toFixed(2)})\n`;
            });
            textoRelatorio += `\n*TOTAL VENDIDO HOJE: R$ ${totalVendido.toFixed(2)}*`;
            textoRelatorio += `\n*TOTAL RECEBIDO HOJE: R$ ${(-totalPago).toFixed(2)}*`;
            await sock.sendMessage(jid, { text: textoRelatorio });
        } else if (comando === 'relatorio') {
            const periodo = restoDoTexto || 'semana';
            let dataInicio = new Date();
            let dataFim = new Date();
            let titulo = '';
            if (periodo === 'semana') {
                dataInicio.setDate(dataFim.getDate() - 7);
                titulo = 'Últimos 7 dias';
            } else if (periodo === 'mes') {
                dataInicio = new Date(dataFim.getFullYear(), dataFim.getMonth(), 1);
                titulo = 'Este Mês';
            } else if (/^\d{4}-\d{2}$/.test(periodo)) {
                const [ano, mes] = periodo.split('-');
                dataInicio = new Date(ano, parseInt(mes) - 1, 1);
                dataFim = new Date(ano, parseInt(mes), 0, 23, 59, 59, 999);
                titulo = `Mês ${mes}/${ano}`;
            } else {
                return await sock.sendMessage(jid, { text: '⚠️ Período inválido. Use: `.relatorio semana`, `.relatorio mes` ou `.relatorio AAAA-MM`.' });
            }
            dataInicio.setHours(0, 0, 0, 0);
            const vendas = await db.gerarRelatorioVendas(contaId, dataInicio, dataFim);
            if (vendas.length === 0) return await sock.sendMessage(jid, { text: `Nenhuma venda registrada para o período: *${titulo}*.` });
            let textoRelatorio = `*Relatório de Vendas - ${titulo}*\n\n`;
            const vendasReais = vendas.filter(v => v.valor_total > 0);
            const pagamentos = vendas.filter(v => v.valor_total < 0);
            let totalVendido = vendasReais.reduce((acc, v) => acc + v.valor_total, 0);
            let totalPago = pagamentos.reduce((acc, p) => acc + p.valor_total, 0);
            textoRelatorio += `Total de Itens Vendidos: *${vendasReais.length}*\n`;
            textoRelatorio += `Valor Total Vendido: *R$ ${totalVendido.toFixed(2)}*\n`;
            textoRelatorio += `Valor Total Recebido (Pagamentos): *R$ ${(-totalPago).toFixed(2)}*`;
            await sock.sendMessage(jid, { text: textoRelatorio });
        } else if (comando === 'total fiado') {
            const totalGeral = await db.calcularDividaGeral(contaId);
            await sock.sendMessage(jid, { text: `💰 *Balanço Geral do Fiado*\n\nO valor total de todas as dívidas ativas no seu estabelecimento é de: *R$ ${totalGeral.toFixed(2)}*` });
        } else if (comando === 'maiores dividas') {
            const ranking = await db.rankingMaioresDividas(contaId, 5);
            if (ranking.length === 0) return await sock.sendMessage(jid, { text: '🎉 Nenhum cliente com dívidas pendentes!' });
            let textoRanking = '위험 Top 5 Maiores Dívidas\n\n';
            ranking.forEach((item, index) => {
                textoRanking += `${index + 1}. ${item.nome} - *R$ ${item.divida.toFixed(2)}*\n`;
            });
            await sock.sendMessage(jid, { text: textoRanking });
        } else if (comando === 'melhores clientes') {
            const ranking = await db.rankingMelhoresClientes(contaId, 5);
            if (ranking.length === 0) return await sock.sendMessage(jid, { text: 'Nenhuma venda registrada nos últimos 30 dias.' });
            let textoRanking = '⭐ Top 5 Melhores Clientes (Últimos 30 dias)\n\n';
            ranking.forEach((item, index) => {
                textoRanking += `${index + 1}. ${item.nome} - *R$ ${item.total.toFixed(2)}* consumidos\n`;
            });
            await sock.sendMessage(jid, { text: textoRanking });
        } else if (comando === 'mais vendidos') {
            const ranking = await db.rankingProdutosMaisVendidos(contaId, 10);
            if (ranking.length === 0) return await sock.sendMessage(jid, { text: 'Nenhuma venda registrada nos últimos 30 dias.' });
            let textoRanking = '📊 Top 10 Produtos Mais Vendidos (Últimos 30 dias)\n\n';
            ranking.forEach((item, index) => {
                textoRanking += `${index + 1}. *${item.produto.toUpperCase()}* - ${item.total} unidades\n`;
            });
            await sock.sendMessage(jid, { text: textoRanking });
        } else if (comando === 'limite fiado') {
            const novoLimite = parseFloat(restoDoTexto);
            if (isNaN(novoLimite) || novoLimite < 0) return await sock.sendMessage(jid, { text: '⚠️ Valor inválido. Formato: `.limite fiado <valor>` (ex: `.limite fiado 300`)' });
            await db.atualizarLimiteFiado(contaId, novoLimite);
            await sock.sendMessage(jid, { text: `✅ Limite de crédito (fiado) atualizado para *R$ ${novoLimite.toFixed(2)}*.` });
        } else if (comando === 'ajuda') {
            const menuAjudaCompleto = `*Assistente de Gestão* 🍻
Aqui estão todos os comandos disponíveis:

⭐ *COMO ANOTAR UMA VENDA*
Basta escrever na ordem: \`Nome\`, \`Qtd\`, \`Produto\` e \`Preço Unitário\`.
*Ex:* \`Maria 2 Cerveja 6\`

👤 *GESTÃO DE CLIENTES*
• \`.novo <nome>\`
• \`.clientes\`
• \`.alterar nome <antigo> - <novo>\`
• \`.excluir cliente <nome>\`
• \`.somar <nome1> + <nome2>\`

💰 *GESTÃO DE DÍVIDAS*
• \`.extrato <nome>\`
• \`.divida <nome>\`
• \`.pago <nome> [valor]\`

📈 *RELATÓRIOS E ANÁLISES*
• \`.relatorio dia\` ou \`.relatoriodia\`
• \`.relatorio <semana|mes>\`
• \`.total fiado\`
• \`.maiores dividas\`
• \`.melhores clientes\`
• \`.mais vendidos\`

⚙️ *CONFIGURAÇÕES E MANUTENÇÃO*
• \`.limite fiado <valor>\`
• \`.corrigir cliente <nome>\`
• \`.unificar clientes <nome>\`
• \`.ajuda\`
`;
            await sock.sendMessage(jid, { text: menuAjudaCompleto });
        } else {
            await sock.sendMessage(jid, { text: `Comando ".${args[0]}" não reconhecido. Digite *.ajuda* para ver a lista de comandos.` });
        }
        return;
    }

    try {
        const palavras = texto.split(' ');
        let indicePrimeiroItem = -1;
        for (let i = 0; i < palavras.length; i++) {
            if (!isNaN(parseFloat(palavras[i]))) {
                indicePrimeiroItem = i;
                break;
            }
        }
        if (indicePrimeiroItem <= 0) return;
        const nomeCliente = palavras.slice(0, indicePrimeiroItem).join(' ');
        const textoDoPedido = palavras.slice(indicePrimeiroItem).join(' ');
        const resultadoBusca = await db.encontrarClienteOuSugerirCorrecao(nomeCliente, contaId);
        const clienteVenda = await handleClientSearchResult(sock, jid, resultadoBusca, nomeCliente);
        if (!clienteVenda) return;
        const itens = analisarItensDoPedido(textoDoPedido);
        if (itens.length === 0) return await sock.sendMessage(jid, { text: `⚠️ Não entendi os itens do pedido. Formato: <Qtd> <Produto> <Preço Unit>` });
        let valorTotalVenda = 0;
        let resumoVenda = `✅ Venda registrada para *${clienteVenda.nome}*:\n`;
        for (const item of itens) {
            await db.adicionarVenda({
                clienteId: clienteVenda.id, quantidade: item.quantidade, valorUnitario: item.valorUnitario, valorTotal: item.valorTotal, descricaoProduto: item.descricaoProduto, contaId: contaId
            });
            valorTotalVenda += item.valorTotal;
            resumoVenda += `\n- ${item.quantidade}x ${item.descricaoProduto} (R$ ${item.valorTotal.toFixed(2)})`;
        }
        resumoVenda += `\n\n*Total da Venda: R$ ${valorTotalVenda.toFixed(2)}*`;
        await sock.sendMessage(jid, { text: resumoVenda });
        const dividaAtual = await db.calcularDividaTotal(clienteVenda.id, contaId);
        const limiteCredito = conta.limite_fiado || 200;
        if (dividaAtual >= limiteCredito) {
            await sock.sendMessage(jid, { text: `🚨 *ATENÇÃO!* ${clienteVenda.nome} ultrapassou o limite de crédito! Dívida atual: R$ ${dividaAtual.toFixed(2)}.` });
        }
    } catch (e) {
        console.error("Erro ao processar venda:", e);
        await sock.sendMessage(jid, { text: "❌ Erro ao registrar a venda." });
    }
}
