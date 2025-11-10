import db from './database.js';

const menuAjuda = `*Receba Aí - Comandos* 📖

➡️ *COMO REGISTRAR UMA VENDA*
Basta escrever o nome do cliente, seguido dos itens.
*Ex:* \`Maria 2 refri 5, 1 bolo 20\`

👤 *CLIENTES*
• \`.novo <nome>\`: Novo cliente.
• \`.clientes\`: Lista todos os Clientes.
• \`.excluir <nome>\`

💰 *COBRANÇAS*
• \`.divida <nome>\`
• \`.extrato <nome>\`: Extrato completo.
• \`.pago <nome> [valor]\`

📈 *RELATÓRIOS*
• \`.relatorio\` ou \`.resumo\`
• \`.devedores\`
• \`.total\`

⚙️ *AJUDA*
• \`.ajuda\` ou \`.menu\`
`;

// --- Estados para interações ---
let operacoesPendentes = {};
let estadosDosUsuarios = {};

function analisarVendaInteligente(texto) {
    const itens = [];
    const textoProcessado = texto.trim();
    const partes = textoProcessado.split(',');

    for (const parte of partes) {
        const palavras = parte.trim().split(/\s+/);
        if (palavras.length < 2) continue;

        // A última palavra DEVE ser o valor
        const valorStr = palavras[palavras.length - 1].replace(',', '.');
        if (isNaN(parseFloat(valorStr))) continue; // Se a última palavra não for um número, não é uma venda válida.

        const valor = parseFloat(valorStr);
        let palavrasDoProduto = palavras.slice(0, -1); // Pega tudo, menos o valor
        let quantidade = 1; // Quantidade padrão

        // Verifica se a PRIMEIRA palavra é a quantidade (ex: 3 refri 5)
        if (palavrasDoProduto.length > 0 && !isNaN(parseFloat(palavrasDoProduto[0]))) {
            quantidade = parseFloat(palavrasDoProduto[0]);
            palavrasDoProduto.shift(); // Remove a quantidade do início
        } 
        // Senão, verifica se a ÚLTIMA palavra (antes do preço) é a quantidade (ex: refri 3 5)
        else if (palavrasDoProduto.length > 1 && !isNaN(parseFloat(palavrasDoProduto[palavrasDoProduto.length - 1]))) {
            quantidade = parseFloat(palavrasDoProduto[palavrasDoProduto.length - 1]);
            palavrasDoProduto.pop(); // Remove a quantidade do fim
        }

        const nomeProduto = palavrasDoProduto.join(' ');
        if (nomeProduto) {
            itens.push({
                quantidade,
                descricaoProduto: nomeProduto,
                valorTotal: quantidade * valor,
                valorUnitario: valor
            });
        }
    }
    return itens;
}

function normalizarString(texto) {
    if (!texto) return '';
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function registrarVendaParaCliente(cliente, itens, contaId, sock, jid) {
    let valorTotalVenda = 0;
    let resumoVenda = `✅ Venda registrada para *${cliente.nome}*:\n`;

    for (const item of itens) {
        const venda = {
            cliente_id: cliente.id,
            conta_id: contaId,
            quantidade: item.quantidade,
            descricao_produto: item.descricaoProduto,
            valor_unitario: item.valorUnitario,
            valor_total: item.valorTotal,
            pago: false,
        };
        await db.adicionarVenda(venda);
        valorTotalVenda += item.valorTotal;
        resumoVenda += `\n- ${item.quantidade}x ${item.descricaoProduto} (R$ ${item.valorTotal.toFixed(2)})`;
    }

    const dividaAtual = await db.calcularDividaTotal(cliente.id, contaId);
    resumoVenda += `\n\n*Total da Venda: R$ ${valorTotalVenda.toFixed(2)}*`;
    resumoVenda += `\n*Saldo Devedor: R$ ${dividaAtual.toFixed(2)}*`;

    await sock.sendMessage(jid, { text: resumoVenda });
}

export async function processarComandoNegocio(msg, sock) {
    const jid = msg.key.remoteJid;
    const conta = await db.encontrarContaPorGrupoId(jid);
    if (!conta) return;
    const contaId = conta.id;
    const textoOriginal = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
    if (!textoOriginal) return;

    if (estadosDosUsuarios[jid] === 'aguardando_confirmacao_cliente') {
        const pendente = operacoesPendentes[jid];
        if (!pendente || Date.now() > pendente.expiraEm) {
            delete estadosDosUsuarios[jid];
            delete operacoesPendentes[jid];
            return await sock.sendMessage(jid, { text: "⏳ Operação expirada. Por favor, envie a venda novamente." });
        }

        let clienteFinal;
        const escolha = textoOriginal.trim();

        if (escolha === '1') {
            const resultado = await db.adicionarCliente(pendente.opcoes.novo, contaId);
            clienteFinal = resultado.cliente;
            await sock.sendMessage(jid, { text: `✅ Cliente "*${clienteFinal.nome}*" criado com sucesso!` });
        } else if (escolha === '2' && pendente.opcoes.similar) {
            clienteFinal = await db.buscarClientePorNome(pendente.opcoes.similar.nome, contaId);
        } else {
            delete estadosDosUsuarios[jid];
            delete operacoesPendentes[jid];
            return await sock.sendMessage(jid, { text: "❌ Operação cancelada." });
        }

        if (clienteFinal) {
            const itens = analisarVendaInteligente(pendente.textoVenda);
            await registrarVendaParaCliente(clienteFinal, itens, contaId, sock, jid);
        }

        delete estadosDosUsuarios[jid];
        delete operacoesPendentes[jid];
        return;
    }

    if (textoOriginal.startsWith('.')) {
        try {
            const textoLimpo = textoOriginal.slice(1).trim();
            const args = textoLimpo.split(/\s+/);
            const comandoNormalizado = normalizarString(args[0]);
            const restoDoTexto = args.slice(1).join(' ');

            switch (comandoNormalizado) {
                case 'ajuda': case 'menu':
                    return await sock.sendMessage(jid, { text: menuAjuda });
                
                // --- COMANDO RESTAURADO ---
                case 'relatorio': case 'resumo': {
                    const hoje = new Date();
                    const inicioDoDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0, 0);
                    const fimDoDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59, 999);
                    
                    const vendasHoje = await db.gerarRelatorioVendas(contaId, inicioDoDia, fimDoDia);
                    const totalVendidoHoje = vendasHoje
                        .filter(v => v.valor_total > 0)
                        .reduce((acc, v) => acc + v.valor_total, 0);
                    
                    const devedores = await db.rankingMaioresDividas(contaId, 3);
                    const dividasAntigas = await db.buscarDividasAntigas(contaId);

                    let relatorio = `*Resumo Gerencial do Dia* 📈\n\n`;
                    relatorio += `*Vendas de Hoje:* R$ ${totalVendidoHoje.toFixed(2)}\n\n`;
                    
                    if (devedores.length > 0) {
                        relatorio += "Top 3 Maiores Devedores:\n";
                        devedores.forEach(d => relatorio += `- ${d.nome}: R$ ${d.divida.toFixed(2)}\n`);
                    }
                    
                    if (dividasAntigas.length > 0) {
                        relatorio += `\n🚨 *Atenção! Dívidas com mais de 30 dias:*\n`;
                        dividasAntigas.forEach(d => relatorio += `- ${d.nome}: R$ ${d.divida.toFixed(2)}\n`);
                    }

                    return await sock.sendMessage(jid, { text: relatorio });
                }

                // --- NOVO COMANDO ---
                case 'excluir': {
                    if (!restoDoTexto) return await sock.sendMessage(jid, { text: '⚠️ Formato: .excluir <nome do cliente>' });
                    const cliente = await db.buscarClientePorNome(restoDoTexto, contaId);
                    if (!cliente) return await sock.sendMessage(jid, { text: `❌ Cliente "${restoDoTexto}" não encontrado.` });
                    
                    await db.excluirCliente(cliente.id, contaId);
                    return await sock.sendMessage(jid, { text: `✅ Cliente *${cliente.nome}* e todo o seu histórico foram excluídos.` });
                }
                
                case 'novo':
                    if (!restoDoTexto) return await sock.sendMessage(jid, { text: '⚠️ Formato: .novo <nome>' });
                    const res = await db.adicionarCliente(restoDoTexto, contaId);
                    return await sock.sendMessage(jid, { text: res.message || `⚠️ Cliente "${res.cliente.nome}" já existe.` });

                case 'clientes': {
                    const clientes = await db.listarTodosClientes(contaId);
                    if (!clientes.length) return await sock.sendMessage(jid, { text: 'Nenhum cliente cadastrado.' });
                    
                    // CORREÇÃO: Título da lista alterado
                    let lista = '*Situação dos Clientes:*\n\n';
                    
                    for (const c of clientes) {
                        const divida = await db.calcularDividaTotal(c.id, contaId);
                        
                        // CORREÇÃO: Lógica para mostrar todos os clientes, com status diferente
                        const status = divida > 0 ? `(Deve: R$ ${divida.toFixed(2)})` : '(✅ Em dia)';
                        lista += `- ${c.nome}: ${status}\n`;
                    }
                    
                    await sock.sendMessage(jid, { text: lista });
                    break;
                }

                case 'divida':
                    if (!restoDoTexto) return await sock.sendMessage(jid, { text: '⚠️ Formato: .divida <nome>' });
                    const cliDiv = await db.buscarClientePorNome(restoDoTexto, contaId);
                    if (!cliDiv) return await sock.sendMessage(jid, { text: `❌ Cliente "${restoDoTexto}" não encontrado.` });
                    const total = await db.calcularDividaTotal(cliDiv.id, contaId);
                    return await sock.sendMessage(jid, { text: `Dívida de *${cliDiv.nome}*: *R$ ${total.toFixed(2)}*` });

                case 'pago': {
                    const textoLimpoPago = textoOriginal.replace(/^\.pago\s*/i, '');
                    let nomeCliente;
                    let valorPago = NaN;
                    
                    const palavras = textoLimpoPago.split(' ');
                    const ultimoArg = palavras[palavras.length - 1].replace(',', '.');
                    const valorPotencial = parseFloat(ultimoArg);

                    if (!isNaN(valorPotencial) && valorPotencial > 0) {
                        valorPago = valorPotencial;
                        nomeCliente = palavras.slice(0, -1).join(' ');
                    } else {
                        nomeCliente = textoLimpoPago;
                    }
                    
                    if (!nomeCliente) return await sock.sendMessage(jid, { text: '⚠️ Formato: .pago <nome> [valor]' });

                    const cliente = await db.buscarClientePorNome(nomeCliente, contaId);
                    if (!cliente) return await sock.sendMessage(jid, { text: `❌ Cliente "${nomeCliente}" não encontrado.` });

                    if (!isNaN(valorPago) && valorPago > 0) {
                        // 1. Pega o valor da dívida ANTES de registrar o pagamento
                        const dividaAntiga = await db.calcularDividaTotal(cliente.id, contaId);

                        // 2. Adiciona o pagamento com "pago: false" para que ele entre no cálculo
                        await db.adicionarVenda({
                            cliente_id: cliente.id,
                            conta_id: contaId,
                            quantidade: 1,
                            descricao_produto: "--- PAGAMENTO ---",
                            valor_unitario: -valorPago,
                            valor_total: -valorPago,
                            pago: false // <-- CORREÇÃO CRUCIAL AQUI
                        });
                        
                        // 3. Calcula o novo saldo de forma imediata para a mensagem de resposta
                        const dividaRestante = dividaAntiga - valorPago;
                        await sock.sendMessage(jid, { text: `✅ Pagamento de R$ ${valorPago.toFixed(2)} registrado para *${cliente.nome}*.\nSaldo restante: R$ ${dividaRestante.toFixed(2)}` });
                    } else {
                        // Se não for pagamento parcial, quita tudo
                        await db.quitarDivida(cliente.id, contaId);
                        await sock.sendMessage(jid, { text: `✅ Todas as pendências de *${cliente.nome}* foram quitadas!` });
                    }
                    break;
                }

                case 'extrato':
                    if (!restoDoTexto) return await sock.sendMessage(jid, { text: '⚠️ Formato: .extrato <nome>' });
                    const cliExt = await db.buscarClientePorNome(restoDoTexto, contaId);
                    if (!cliExt) return await sock.sendMessage(jid, { text: `❌ Cliente "${restoDoTexto}" não encontrado.` });
                    const pendencias = await db.gerarExtrato(cliExt.id, contaId);
                    if (!pendencias.length) return await sock.sendMessage(jid, { text: `✅ *${cliExt.nome}* não tem pendências.` });
                    let extratoTxt = `*Extrato de ${cliExt.nome}*\n\n`;
                    pendencias.forEach(v => extratoTxt += `- ${new Date(v.created_at).toLocaleDateString('pt-BR')}: ${v.quantidade}x ${v.descricao_produto}: R$ ${v.valor_total.toFixed(2)}\n`);
                    const divTotal = await db.calcularDividaTotal(cliExt.id, contaId);
                    extratoTxt += `\n*TOTAL: R$ ${divTotal.toFixed(2)}*`;
                    return await sock.sendMessage(jid, { text: extratoTxt });

                case 'devedores':
                    const rank = await db.rankingMaioresDividas(contaId, 10);
                    if (!rank.length) return await sock.sendMessage(jid, { text: '🎉 Nenhum cliente com dívidas!' });
                    let rankTxt = '👥 *Maiores Devedores*\n\n';
                    rank.forEach((item, i) => rankTxt += `${i + 1}. ${item.nome} - *R$ ${item.divida.toFixed(2)}*\n`);
                    return await sock.sendMessage(jid, { text: rankTxt });

                case 'total':
                    const totalGeral = await db.calcularDividaGeral(contaId);
                    return await sock.sendMessage(jid, { text: `💰 *Total a Receber:* *R$ ${totalGeral.toFixed(2)}*` });
                
                default:
                    return await sock.sendMessage(jid, { text: `Comando ".${args[0]}" não reconhecido. Digite *.menu* ou *.ajuda*.` });
            }
        } catch (error) {
            console.error("Erro ao processar comando:", error);
            await sock.sendMessage(jid, { text: "❌ Ocorreu um erro ao processar o comando." });
        }
        return;
    }

    try {
        const [nomeClientePotencial, ...vendaArgs] = textoOriginal.split(' ');
        const textoVenda = vendaArgs.join(' ');
        const itens = analisarVendaInteligente(textoVenda);
        if (itens.length === 0) return;

        let cliente = await db.buscarClientePorNome(nomeClientePotencial, contaId);

        if (cliente) {
            await registrarVendaParaCliente(cliente, itens, contaId, sock, jid);
        } else {
            const similares = await db.buscarClientesSimilares(nomeClientePotencial, contaId);
            let mensagemInterativa = `🤔 Cliente "*${nomeClientePotencial}*" não encontrado.\n\n`;
            if (similares.length > 0) {
                mensagemInterativa += `Ele é parecido com "*${similares[0].nome}*"?\n\n`;
                mensagemInterativa += `*Responda com o número:*\n1️⃣ - Cadastrar "*${nomeClientePotencial}*" como novo.\n2️⃣ - Usar o cliente "*${similares[0].nome}*".`;
                operacoesPendentes[jid] = { textoVenda, opcoes: { novo: nomeClientePotencial, similar: similares[0] }, expiraEm: Date.now() + 2 * 60 * 1000 };
            } else {
                mensagemInterativa += `*Responda com o número:*\n1️⃣ - Cadastrar "*${nomeClientePotencial}*" como novo.\n Ou envie "cancelar".`;
                operacoesPendentes[jid] = { textoVenda, opcoes: { novo: nomeClientePotencial }, expiraEm: Date.now() + 2 * 60 * 1000 };
            }
            estadosDosUsuarios[jid] = 'aguardando_confirmacao_cliente';
            await sock.sendMessage(jid, { text: mensagemInterativa });
        }
    } catch (e) {
        console.error("Erro ao processar venda inteligente:", e);
        await sock.sendMessage(jid, { text: "❌ Erro inesperado ao registrar a venda." });
    }
}
