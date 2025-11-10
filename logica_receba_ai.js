import db from './database.js';
import dbRelatorios from './dbrelatorios.js';

// --- TEXTOS DE MENU ---
const menuAjudaCompleto = `*Receba Aí - Comandos* 📖

➡️ *COMO REGISTRAR UMA VENDA*
Basta escrever o nome do cliente, seguido dos itens.
*Ex:* \`Maria 2 refri 5, 1 bolo 20\`

👤 *CLIENTES*
• \`.novo <nome>\`: Cadastra um novo cliente.
• \`.clientes\`: Lista a situação de todos.
• \`.excluir <nome>\`: Exclui um cliente.
• \`.unificar <nome>\`: Junta clientes duplicados.

💰 *COBRANÇAS*
• \`.divida <nome>\`: Mostra a dívida.
• \`.extrato <nome>\`: Mostra o extrato detalhado.
• \`.pago <nome> [valor]\`: Paga a dívida total ou parcial.

📈 *RELATÓRIOS*
• \`.resumo\` ou \`.relatorio\`
• \`.devedores\`: Maiores devedores.
• \`.total\`: Total a receber.

⚙️ *AJUDA*
• \`.ajuda\` ou \`.menu\`
`;

const menuPrincipalNumerado = `*Menu Principal - Receba Aí* 🚀

Responda com o número da categoria desejada:

1️⃣ - Clientes e Vendas
2️⃣ - Cobranças e Extratos
3️⃣ - Relatórios e Resumos`;

const subMenuClientes = `*1️⃣ Comandos de Clientes e Vendas*

• \`.novo <nome>\`
• \`.clientes\`
• \`.excluir <nome>\`
• \`.unificar <nome>\``;

const subMenuCobrancas = `*2️⃣ Comandos de Cobranças*

• \`.divida <nome>\`
• \`.extrato <nome>\`
• \`.pago <nome> [valor]\``;

const subMenuRelatorios = `*3️⃣ Comandos de Relatórios*

• \`.resumo\` ou \`.relatorio\`
• \`.devedores\`
• \`.total\``;


// --- GERENCIAMENTO DE ESTADO ---
let operacoesPendentes = {};
let estadosDosUsuarios = {};

// --- FUNÇÕES AUXILIARES ---

function normalizarString(texto) {
    if (!texto) return '';
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Converte números por extenso em dígitos. Ex: "duas" -> "2".
 * @param {string} texto O texto do pedido.
 * @returns {string} O texto com os números convertidos.
 */
function converterNumerosPorExtenso(texto) {
    const mapaNumeros = {
        'um': '1', 'uma': '1',
        'dois': '2', 'duas': '2',
        'tres': '3', 'três': '3',
        'quatro': '4',
        'cinco': '5',
        'seis': '6',
        'sete': '7',
        'oito': '8',
        'nove': '9',
        'dez': '10',
    };

    const palavras = texto.split(' ');
    const palavrasConvertidas = palavras.map(palavra => {
        const palavraNormalizada = normalizarString(palavra);
        return mapaNumeros[palavraNormalizada] || palavra;
    });

    return palavrasConvertidas.join(' ');
}

/**
 * Analisa uma string de venda em linguagem natural e a transforma em uma lista de itens.
 * Trata corretamente a quantidade implícita como 1.
 * @param {string} texto A parte da mensagem que contém os itens da venda.
 * @returns {Array<Object>} Uma lista de objetos, cada um representando um item da venda.
 */
function analisarVendaInteligente(texto) {
    const itens = [];
    const palavras = texto.replace(/,/g, ' ').trim().split(/\s+/);
    let buffer = [];

    for (let i = 0; i < palavras.length; i++) {
        const palavraAtual = palavras[i];
        const proximaPalavra = palavras[i + 1];
        buffer.push(palavraAtual);
        const ultimoDoBufferStr = buffer[buffer.length - 1].replace(',', '.');
        const eNumeroValido = !isNaN(parseFloat(ultimoDoBufferStr));

        if (buffer.length >= 2 && eNumeroValido) {
            const proximaPalavraENumero = proximaPalavra !== undefined && !isNaN(parseFloat(proximaPalavra.replace(',', '.')));
            if (proximaPalavra === undefined || proximaPalavraENumero) {
                const valor = parseFloat(buffer.pop().replace(',', '.'));
                
                let quantidade = 1;
                if (buffer.length > 0 && !isNaN(parseFloat(buffer[0]))) {
                    quantidade = parseFloat(buffer.shift());
                }

                const descricaoProduto = buffer.join(' ');
                if (descricaoProduto) {
                    itens.push({
                        quantidade,
                        descricaoProduto,
                        valorUnitario: valor,
                        valorTotal: quantidade * valor
                    });
                }
                buffer = [];
            }
        }
    }
    return itens;
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


// --- PROCESSADOR PRINCIPAL DE MENSAGENS ---
export async function processarComandoNegocio(msg, sock) {
    const jid = msg.key.remoteJid;
    const conta = await db.encontrarContaPorGrupoId(jid);
    if (!conta) return;
    const contaId = conta.id;
    const textoOriginal = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
    if (!textoOriginal) return;

    // --- LÓGICA DE INTERAÇÃO (AGUARDANDO RESPOSTA) ---
    const estado = estadosDosUsuarios[jid];
    if (estado) {
        const pendente = operacoesPendentes[jid];
        const escolha = textoOriginal.trim();

        if (!pendente || Date.now() > pendente.expiraEm) {
            delete estadosDosUsuarios[jid]; delete operacoesPendentes[jid];
            return await sock.sendMessage(jid, { text: "⏳ Operação expirada. Por favor, tente novamente." });
        }

        if (escolha.toLowerCase().startsWith('cancel')) {
            delete estadosDosUsuarios[jid]; delete operacoesPendentes[jid];
            return await sock.sendMessage(jid, { text: "❌ Operação cancelada." });
        }

        if (estado === 'aguardando_menu_principal') {
            let subMenu;
            if (escolha === '1') subMenu = subMenuClientes;
            else if (escolha === '2') subMenu = subMenuCobrancas;
            else if (escolha === '3') subMenu = subMenuRelatorios;
            else await sock.sendMessage(jid, { text: "Opção inválida. Responda com um número ou 'cancelar'." });

            if(subMenu) await sock.sendMessage(jid, { text: subMenu });

        } else if (estado === 'aguardando_confirmacao_cliente') {
            let clienteFinal;
            if (escolha === '1') {
                const resultado = await db.adicionarCliente(pendente.opcoes.novo, contaId);
                clienteFinal = resultado.cliente;
                await sock.sendMessage(jid, { text: `✅ Cliente "*${clienteFinal.nome}*" criado com sucesso!` });
            } else if (escolha === '2' && pendente.opcoes.similar) {
                clienteFinal = await db.buscarClientePorNome(pendente.opcoes.similar.nome, contaId);
            } else {
                return await sock.sendMessage(jid, { text: "Opção inválida. Responda com o número ou 'cancelar'." });
            }
            if (clienteFinal) {
                const itens = analisarVendaInteligente(pendente.textoVenda);
                await registrarVendaParaCliente(clienteFinal, itens, contaId, sock, jid);
            }
        }

        delete estadosDosUsuarios[jid]; delete operacoesPendentes[jid];
        return;
    }

    // --- LÓGICA DE VENDA INTELIGENTE (TEXTO LIVRE SEM ".") ---
    if (!textoOriginal.startsWith('.')) {
        try {
            const textoProcessado = converterNumerosPorExtenso(textoOriginal);
            const palavras = textoProcessado.split(' ');
            const indicePrimeiroNumero = palavras.findIndex(p => !isNaN(parseFloat(p.replace(',', '.'))));

            if (indicePrimeiroNumero <= 0) return;

            const nomeClientePotencial = palavras.slice(0, indicePrimeiroNumero).join(' ');
            if (nomeClientePotencial.split(' ').length > 4) return;

            const textoVenda = palavras.slice(indicePrimeiroNumero).join(' ');
            const itens = analisarVendaInteligente(textoVenda);
            if (itens.length === 0) return;

            let cliente = await db.buscarClientePorNome(nomeClientePotencial, contaId);

            if (cliente) {
                await registrarVendaParaCliente(cliente, itens, contaId, sock, jid);
            } else {
                const similares = await db.buscarClientesSimilares(nomeClientePotencial, contaId);
                let mensagemInterativa = `🤔 Cliente "*${nomeClientePotencial}*" não encontrado.\n\n`;
                let opcoes = { novo: nomeClientePotencial };

                if (similares.length > 0) {
                    mensagemInterativa += `Ele é parecido com "*${similares[0].nome}*"?\n\n*Responda com o número ou envie "cancelar":*\n1️⃣ - Cadastrar "*${nomeClientePotencial}*" como novo.\n2️⃣ - Usar o cliente "*${similares[0].nome}*".`;
                    opcoes.similar = similares[0];
                } else {
                    mensagemInterativa += `*Responda com o número ou envie "cancelar":*\n1️⃣ - Cadastrar "*${nomeClientePotencial}*" como novo.`;
                }
                
                operacoesPendentes[jid] = { textoVenda, opcoes, expiraEm: Date.now() + 2 * 60 * 1000 };
                estadosDosUsuarios[jid] = 'aguardando_confirmacao_cliente';
                await sock.sendMessage(jid, { text: mensagemInterativa });
            }
        } catch (e) {
            console.error("Erro ao processar venda inteligente:", e);
        }
        return;
    }

    // --- LÓGICA PARA COMANDOS COM "." ---
    try {
        const textoLimpo = textoOriginal.slice(1).trim();
        if (!textoLimpo) return;

        const [comando, ...args] = textoLimpo.split(/\s+/);
        const restoDoTexto = args.join(' ');
        const comandoNormalizado = normalizarString(comando);

        switch (comandoNormalizado) {
            case 'ajuda':
                return await sock.sendMessage(jid, { text: menuAjudaCompleto });
            case 'menu':
                estadosDosUsuarios[jid] = 'aguardando_menu_principal';
                operacoesPendentes[jid] = { expiraEm: Date.now() + 2 * 60 * 1000 };
                return await sock.sendMessage(jid, { text: menuPrincipalNumerado });
            case 'novo':
                if (!restoDoTexto) return await sock.sendMessage(jid, { text: '⚠️ Formato: .novo <nome>' });
                const res = await db.adicionarCliente(restoDoTexto, contaId);
                return await sock.sendMessage(jid, { text: res.message || `⚠️ Cliente "${res.cliente.nome}" já existe.` });
            case 'clientes': {
                const clientes = await db.listarTodosClientes(contaId);
                if (!clientes.length) return await sock.sendMessage(jid, { text: 'Nenhum cliente cadastrado.' });
                let lista = '*Situação dos Clientes:*\n\n';
                for (const c of clientes) {
                    const divida = await db.calcularDividaTotal(c.id, contaId);
                    const status = divida > 0 ? `(Deve: R$ ${divida.toFixed(2)})` : '(✅ Em dia)';
                    lista += `- ${c.nome}: ${status}\n`;
                }
                return await sock.sendMessage(jid, { text: lista });
            }
            case 'relatorio':
            case 'resumo': {
                const hoje = new Date();
                const inicioDoDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0, 0);
                const fimDoDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59, 999);
                const vendasHoje = await dbRelatorios.gerarRelatorioVendas(contaId, inicioDoDia, fimDoDia);
                const totalVendidoHoje = vendasHoje.filter(v => v.valor_total > 0).reduce((acc, v) => acc + v.valor_total, 0);
                const devedores = await dbRelatorios.rankingMaioresDividas(contaId, 3);
                const dividasAntigas = await dbRelatorios.buscarDividasAntigas(contaId);

                let relatorio = `*Resumo Gerencial do Dia* 📈\n\n` + `*Vendas de Hoje:* R$ ${totalVendidoHoje.toFixed(2)}\n\n`;
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
            case 'devedores': {
                const rank = await dbRelatorios.rankingMaioresDividas(contaId, 10);
                if (!rank.length) return await sock.sendMessage(jid, { text: '🎉 Nenhum cliente com dívidas!' });
                let rankTxt = '👥 *Maiores Devedores*\n\n';
                rank.forEach((item, i) => rankTxt += `${i + 1}. ${item.nome} - *R$ ${item.divida.toFixed(2)}*\n`);
                return await sock.sendMessage(jid, { text: rankTxt });
            }
            case 'total': {
                const totalGeral = await db.calcularDividaGeral(contaId);
                return await sock.sendMessage(jid, { text: `💰 *Total a Receber:* *R$ ${totalGeral.toFixed(2)}*` });
            }
            case 'unificar':
                if (!restoDoTexto) return await sock.sendMessage(jid, { text: '⚠️ Formato: .unificar <nome>' });
                const resUnificar = await db.unificarClientes(restoDoTexto, contaId);
                return await sock.sendMessage(jid, { text: resUnificar.message });

            case 'excluir':
            case 'divida':
            case 'pago':
            case 'extrato': {
                if (!restoDoTexto) return await sock.sendMessage(jid, { text: `⚠️ Formato: .${comando} <nome do cliente> [valor]` });

                let nomeCliente = restoDoTexto;
                let valorPago = NaN;

                if (comandoNormalizado === 'pago') {
                    const palavras = restoDoTexto.split(' ');
                    const ultimoArg = palavras[palavras.length - 1].replace(',', '.');
                    if (palavras.length > 1 && !isNaN(parseFloat(ultimoArg))) {
                        valorPago = parseFloat(ultimoArg);
                        nomeCliente = palavras.slice(0, -1).join(' ');
                    }
                }

                const clienteEncontrado = await db.buscarClientePorNome(nomeCliente, contaId);
                if (!clienteEncontrado) {
                    return await sock.sendMessage(jid, { text: `❌ Cliente "*${nomeCliente}*" não encontrado. Verifique o nome ou use \`.unificar\` se houver duplicatas.` });
                }

                if (comandoNormalizado === 'excluir') {
                    await db.excluirCliente(clienteEncontrado.id, contaId);
                    return await sock.sendMessage(jid, { text: `✅ Cliente *${clienteEncontrado.nome}* e seu histórico foram excluídos.` });
                }
                if (comandoNormalizado === 'divida') {
                    const totalDivida = await db.calcularDividaTotal(clienteEncontrado.id, contaId);
                    return await sock.sendMessage(jid, { text: `Dívida de *${clienteEncontrado.nome}*: *R$ ${totalDivida.toFixed(2)}*` });
                }
                if (comandoNormalizado === 'extrato') {
                    const pendencias = await db.gerarExtrato(clienteEncontrado.id, contaId);
                    if (!pendencias.length) return await sock.sendMessage(jid, { text: `✅ *${clienteEncontrado.nome}* não tem pendências.` });

                    let extratoTxt = `*Extrato de ${clienteEncontrado.nome}*\n\n`;
                    pendencias.forEach(v => extratoTxt += `- ${new Date(v.created_at).toLocaleDateString('pt-BR')}: ${v.quantidade}x ${v.descricao_produto}: R$ ${v.valor_total.toFixed(2)}\n`);
                    const divTotal = await db.calcularDividaTotal(clienteEncontrado.id, contaId);
                    extratoTxt += `\n*TOTAL: R$ ${divTotal.toFixed(2)}*`;
                    return await sock.sendMessage(jid, { text: extratoTxt });
                }
                if (comandoNormalizado === 'pago') {
                    if (!isNaN(valorPago) && valorPago > 0) {
                        const dividaAntiga = await db.calcularDividaTotal(clienteEncontrado.id, contaId);
                        await db.adicionarVenda({
                            cliente_id: clienteEncontrado.id, conta_id: contaId, quantidade: 1, descricao_produto: "--- PAGAMENTO ---",
                            valor_unitario: -valorPago, valor_total: -valorPago, pago: false
                        });
                        const dividaRestante = dividaAntiga - valorPago;
                        return await sock.sendMessage(jid, { text: `✅ Pagamento de R$ ${valorPago.toFixed(2)} registrado para *${clienteEncontrado.nome}*.\nSaldo restante: R$ ${dividaRestante.toFixed(2)}` });
                    } else {
                        await db.quitarDivida(clienteEncontrado.id, contaId);
                        return await sock.sendMessage(jid, { text: `✅ Todas as pendências de *${clienteEncontrado.nome}* foram quitadas!` });
                    }
                }
                break;
            }
            default:
                return await sock.sendMessage(jid, { text: `Comando ".${comando}" não reconhecido. Digite *.menu* ou *.ajuda*.` });
        }
    } catch (error) {
        console.error("Erro fatal ao processar comando:", error);
        await sock.sendMessage(jid, { text: "❌ Ocorreu um erro inesperado ao processar o comando." });
    }
}
