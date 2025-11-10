import db from './database.js';

/**
 * Analisa uma string de pedido e extrai os itens.
 * Entende o preço unitário e calcula o total.
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
            quantidade,
            descricaoProduto: nomeProduto,
            valorTotal: valorTotal,
            valorUnitario: valorUnitario
        });
    }
    return itens;
}

/**
 * A função principal que lida com os comandos do dono do bar.
 * @param {object} msg - O objeto da mensagem do Baileys.
 * @param {object} sock - A instância da conexão Baileys.
 */
export async function processarComandoBar(msg, sock) {
    const jid = msg.key.remoteJid;
    const conta = await db.encontrarContaPorGrupoId(jid);
    if (!conta) return; 

    const contaId = conta.id;
    const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
    if (!texto) return;

    const [primeiraPalavra, ...resto] = texto.split(' ');
    const comando = primeiraPalavra.toLowerCase();

    // --- LÓGICA DE COMANDOS (começam com /) ---
    if (comando.startsWith('/')) {
        const nomeClienteCmd = resto.join(' ');
        
        switch (comando) {
            case '/novocliente':
                if (!nomeClienteCmd) return await sock.sendMessage(jid, { text: '⚠️ Formato: /novocliente <nome do cliente>' });
                const resCliente = await db.adicionarCliente(nomeClienteCmd, contaId);
                await sock.sendMessage(jid, { text: resCliente.message });
                break;

            case '/extrato':
                if (!nomeClienteCmd) return await sock.sendMessage(jid, { text: '⚠️ Formato: /extrato <nome do cliente>' });
                const clienteExtrato = await db.encontrarClientePorNome(nomeClienteCmd, contaId);
                if (!clienteExtrato) return await sock.sendMessage(jid, { text: `❌ Cliente "${nomeClienteCmd}" não encontrado.` });
                
                const extrato = await db.gerarExtrato(clienteExtrato.id, contaId);
                if (extrato.length === 0) return await sock.sendMessage(jid, { text: `✅ *${clienteExtrato.nome}* não possui dívidas pendentes.` });

                let textoExtrato = `*Extrato de ${clienteExtrato.nome}*\n\n`;
                let totalDivida = 0;
                extrato.forEach(item => {
                    totalDivida += item.valor_total;
                    const data = new Date(item.created_at).toLocaleDateString('pt-BR');
                    textoExtrato += `${data} - ${item.quantidade}x ${item.descricao_produto} - R$ ${item.valor_total.toFixed(2)}\n`;
                });
                textoExtrato += `\n*TOTAL DA DÍVIDA: R$ ${totalDivida.toFixed(2)}*`;
                await sock.sendMessage(jid, { text: textoExtrato });
                break;

            case '/pago':
                if (!nomeClienteCmd) return await sock.sendMessage(jid, { text: '⚠️ Formato: /pago <nome do cliente>' });
                const clientePago = await db.encontrarClientePorNome(nomeClienteCmd, contaId);
                if (!clientePago) return await sock.sendMessage(jid, { text: `❌ Cliente "${nomeClienteCmd}" não encontrado.` });
                
                const quitado = await db.quitarDivida(clientePago.id, contaId);
                
                if (quitado) {
                    await sock.sendMessage(jid, { text: `✅ Dívida de *${clientePago.nome}* foi quitada com sucesso!` });
                } else {
                    await sock.sendMessage(jid, { text: `ℹ️ *${clientePago.nome}* não tinha nenhuma dívida pendente para ser paga.` });
                }
                break;

            case '/ajuda':
                const menuAjuda = `*Cobranças.Bar - Comandos* 🤖

*/novocliente <nome>*
Adiciona um novo cliente.
_Ex: /novocliente Jhey da Silva_

*/extrato <nome_cliente>*
Mostra a dívida detalhada de um cliente.

*/pago <nome_cliente>*
Zera a dívida de um cliente.

*COMO LANÇAR UMA VENDA:*
_Formato: <nome cliente> <qtd> <produto> <preço UNITÁRIO>_

*Exemplo simples:*
\`\`\`Jhey 1 Cerveja 6\`\`\`

*Exemplo com múltiplos itens:*
\`\`\`Maria 2 Coxinha 5 1 Suco 4\`\`\`
_(Lança 2 coxinhas a R$5 cada, e 1 suco a R$4)_`;
                await sock.sendMessage(jid, { text: menuAjuda });
                break;

            // Este é o ÚNICO default. Ele pega qualquer comando que não foi reconhecido.
            default:
                await sock.sendMessage(jid, { text: `Comando "${comando}" não reconhecido. Digite */ajuda*.` });
                break;
        }
        return;
    }

    // --- LÓGICA DE REGISTRO DE VENDA (TEXTO LIVRE) ---
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

        const clienteVenda = await db.encontrarClientePorNome(nomeCliente, contaId);
        if (!clienteVenda) return await sock.sendMessage(jid, { text: `🤔 Cliente "${nomeCliente}" não encontrado.` });
        
        const itens = analisarItensDoPedido(textoDoPedido);
        if (itens.length === 0) return await sock.sendMessage(jid, { text: `⚠️ Não entendi os itens do pedido.` });

        let valorTotalVenda = 0;
        let resumoVenda = `✅ Venda registrada para *${clienteVenda.nome}*:\n`;

        for (const item of itens) {
            await db.adicionarVenda({ 
                clienteId: clienteVenda.id, 
                quantidade: item.quantidade, 
                valorUnitario: item.valorUnitario,
                valorTotal: item.valorTotal,
                descricaoProduto: item.descricaoProduto,
                contaId: contaId 
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
