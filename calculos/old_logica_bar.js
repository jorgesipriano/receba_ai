import db from './database.js';

/**
 * Analisa uma string de pedido e extrai os itens.
 * Entende o preço unitário e calcula o total.
 * Ex: "2 coxinha 5" -> { quantidade: 2, descricaoProduto: 'coxinha', valorUnitario: 5, valorTotal: 10 }
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

    // --- LÓGICA DE COMANDOS (começam com /) ---
    if (texto.startsWith('/')) {
        const [comando, ...args] = texto.split(' ');
        const comandoLower = comando.toLowerCase();

        switch (comandoLower) {
            case '/novo':
                const nomeNovoCliente = args.join(' ');
                if (!nomeNovoCliente) return await sock.sendMessage(jid, { text: '⚠️ Formato: /novocliente <nome do cliente>' });
                const resCliente = await db.adicionarCliente(nomeNovoCliente, contaId);
                await sock.sendMessage(jid, { text: resCliente.message });
                break;

            case '/extrato':
                const nomeExtrato = args.join(' ');
                if (!nomeExtrato) return await sock.sendMessage(jid, { text: '⚠️ Formato: /extrato <nome do cliente>' });
                const clienteExtrato = await db.encontrarClientePorNome(nomeExtrato, contaId);
                if (!clienteExtrato) return await sock.sendMessage(jid, { text: `❌ Cliente "${nomeExtrato}" não encontrado.` });

                const extrato = await db.gerarExtrato(clienteExtrato.id, contaId);
                if (extrato.length === 0) return await sock.sendMessage(jid, { text: `✅ *${clienteExtrato.nome}* não possui dívidas pendentes.` });

                let textoExtrato = `*Extrato de Dívidas de ${clienteExtrato.nome}*\n\n`;
                let totalDividaExtrato = 0;
                extrato.forEach(item => {
                    totalDividaExtrato += item.valor_total;
                    textoExtrato += `${new Date(item.created_at).toLocaleDateString('pt-BR')} - ${item.quantidade}x ${item.descricao_produto} - R$ ${item.valor_total.toFixed(2)}\n`;
                });
                textoExtrato += `\n*TOTAL DA DÍVIDA: R$ ${totalDividaExtrato.toFixed(2)}*`;
                await sock.sendMessage(jid, { text: textoExtrato });
                break;

            case '/pago':
                const nomePago = args.join(' ');
                if (!nomePago) return await sock.sendMessage(jid, { text: '⚠️ Formato: /pago <nome do cliente>' });
                const clientePago = await db.encontrarClientePorNome(nomePago, contaId);
                if (!clientePago) return await sock.sendMessage(jid, { text: `❌ Cliente "${nomePago}" não encontrado.` });

                const dividaTotal = await db.calcularDividaTotal(clientePago.id, contaId);
                if (dividaTotal <=0) {
                    return await sock.sendMessage(jid, { text: `*${clientePago.nome}* já está com a conta em dia.` });
                }

                const quitadoComSucesso = await db.quitarDivida(clientePago.id, contaId);
                
                // 4. Envia uma mensagem de sucesso (com o valor) ou de erro.
                if (quitadoComSucesso) {
                    await sock.sendMessage(jid, { text: `✅ Pagamento recebido! A dívida de *${clientePago.nome}* no valor de *R$ ${dividaTotal.toFixed(2)}* foi quitada.` });
                } else {
                    await sock.sendMessage(jid, { text: `❌ Ocorreu um erro ao tentar quitar a dívida de *${clientePago.nome}*.` });
                }
                break;

            case '/divida':
                const nomeDivida = args.join(' ');
                if (!nomeDivida) return await sock.sendMessage(jid, { text: '⚠️ Formato: /divida <nome do cliente>' });
                const clienteDivida = await db.encontrarClientePorNome(nomeDivida, contaId);
                if (!clienteDivida) return await sock.sendMessage(jid, { text: `❌ Cliente "${nomeDivida}" não encontrado.` });

                const total = await db.calcularDividaTotal(clienteDivida.id, contaId);
                await sock.sendMessage(jid, { text: `A dívida atual de *${clienteDivida.nome}* é de *R$ ${total.toFixed(2)}*.` });
                break;

            case '/relatoriodia':
                const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                const filtroDia = new Date().toISOString().slice(0, 10); // Formato YYYY-MM-DD
                const vendasDia = await db.gerarRelatorioVendas(contaId, filtroDia);

                if (vendasDia.length === 0) return await sock.sendMessage(jid, { text: `Nenhuma venda registrada hoje (${hoje}).` });

                let textoRelatorioDia = `*Relatório de Vendas - ${hoje}*\n\n`;
                let totalVendidoDia = 0;
                vendasDia.forEach(v => {
                    totalVendidoDia += v.valor_total;
                    textoRelatorioDia += `- ${v.cliente_nome}: ${v.quantidade}x ${v.descricao_produto} (R$ ${v.valor_total.toFixed(2)})\n`;
                });
                textoRelatorioDia += `\n*TOTAL VENDIDO HOJE: R$ ${totalVendidoDia.toFixed(2)}*`;
                await sock.sendMessage(jid, { text: textoRelatorioDia });
                break;

            case '/clientes':
                const clientes = await db.listarTodosClientes(contaId);
                if (clientes.length === 0) return await sock.sendMessage(jid, { text: 'Você ainda não cadastrou nenhum cliente.' });

                let listaClientes = '*Lista de Clientes Cadastrados:*\n\n';
                for (const cliente of clientes) {
                    const divida = await db.calcularDividaTotal(cliente.id, contaId);
                    listaClientes += `- ${cliente.nome} (Dívida: R$ ${divida.toFixed(2)})\n`;
                }
                await sock.sendMessage(jid, { text: listaClientes });
                break;

            case '/alterarnome':
                const partes = args.join(' ').split('->');
                if (partes.length !== 2) return await sock.sendMessage(jid, { text: '⚠️ Formato incorreto! Use: /alterarnome <Nome Antigo> -> <Nome Novo>' });

                const nomeAntigo = partes[0].trim();
                const nomeNovo = partes[1].trim();

                const clienteParaAlterar = await db.encontrarClientePorNome(nomeAntigo, contaId);
                if (!clienteParaAlterar) return await sock.sendMessage(jid, { text: `❌ Cliente "${nomeAntigo}" não encontrado.` });

                await db.alterarNomeCliente(clienteParaAlterar.id, nomeNovo, contaId);
                await sock.sendMessage(jid, { text: `✅ O nome do cliente foi alterado de "${nomeAntigo}" para "${nomeNovo}".` });
                break;

            case '/excluircliente':
                const nomeParaExcluir = args.join(' ');
                if (!nomeParaExcluir) return await sock.sendMessage(jid, { text: '⚠️ Formato: /excluircliente <nome do cliente>' });

                const clienteParaExcluir = await db.encontrarClientePorNome(nomeParaExcluir, contaId);
                if (!clienteParaExcluir) return await sock.sendMessage(jid, { text: `❌ Cliente "${nomeParaExcluir}" não encontrado.` });

                await db.excluirCliente(clienteParaExcluir.id, contaId);
                await sock.sendMessage(jid, { text: `🗑️ Cliente "${nomeParaExcluir}" e todas as suas vendas foram excluídos com sucesso.` });
                break;
            
            // --- NOVO BLOCO DE AJUDA ---
            case '/ajuda':
                const menuAjudaCompleto = `Olá! Este é o seu assistente do *Cobranças.Bar*! 🍻

Aqui você gerencia o fiado de forma simples e rápida.

⭐ *COMO ANOTAR UMA VENDA (O MAIS IMPORTANTE!)* ⭐

Basta escrever na ordem: \`Nome do Cliente\`, \`Quantidade\`, \`Produto\` e \`Preço da Unidade\`.

*Exemplo com 1 item:*
\`Maria 2 Cerveja 6\`
_(O bot vai anotar R$ 12,00 na conta da Maria)._

*Exemplo com vários itens de uma vez:*
\`Jose 1 Porção 25 2 Coca 7\`
_(O bot anota a porção e as duas cocas na conta do José)._

---

Aqui estão os outros comandos. É só usar o exemplo e trocar pelo nome do seu cliente!

👤 *PARA GERENCIAR SEUS CLIENTES*

*/novo*
Para cadastrar um cliente.
*Exemplo:* \`/novo Carlos Souza\`

*/clientes*
Para ver sua lista de clientes e quanto cada um deve.
*Exemplo:* \`/clientes\`

*/alterarnome*
Para corrigir um nome escrito errado.
*Exemplo:* \`/alterarnome Jão -> João\`

*/excluircliente*
Para apagar um cliente e suas dívidas. *(Use com cuidado!)*
*Exemplo:* \`/excluircliente Carlos Souza\`

---

💰 *PARA CONSULTAR E QUITAR DÍVIDAS*

*/extrato*
Para ver em detalhes tudo o que um cliente consumiu.
*Exemplo:* \`/extrato Maria\`

*/divida*
Para ver rapidinho o valor total que o cliente deve.
*Exemplo:* \`/divida Maria\`

*/pago*
Para zerar a conta do cliente quando ele pagar tudo.
*Exemplo:* \`/pago Maria\`

---

📈 *PARA VER O RESUMO DO DIA*

*/relatoriodia*
Mostra um relatório de tudo o que foi vendido hoje.
*Exemplo:* \`/relatoriodia\``;
                await sock.sendMessage(jid, { text: menuAjudaCompleto });
                break;

            case '/ajudacliente':
                const menuAjudaCliente = `*Comandos para Gerenciar Clientes* 👤

*/novo <nome>*
Para cadastrar um novo cliente.
*Exemplo:* \`/novo Carlos Souza\`

*/clientes*
Para ver sua lista de clientes e quanto cada um deve.
*Exemplo:* \`/clientes\`

*/alterarnome <antigo> -> <novo>*
Para corrigir um nome escrito errado.
*Exemplo:* \`/alterarnome Jão -> João\`

*/excluircliente <nome>*
Para apagar um cliente e suas dívidas. (Use com cuidado!)
*Exemplo:* \`/excluircliente Carlos Souza\`

*/extrato <nome_cliente>*
Para ver em detalhes tudo o que um cliente consumiu.
*Exemplo:* \`/extrato Maria\`

*/divida <nome_cliente>*
Para ver rapidinho o valor total que o cliente deve.
*Exemplo:* \`/divida Maria\`

*/pago <nome_cliente>*
Para zerar a conta do cliente quando ele pagar tudo.
*Exemplo:* \`/pago Maria\``;
                await sock.sendMessage(jid, { text: menuAjudaCliente });
                break;
            
            case '/ajudarapido':
                const menuAjudaRapido = `*Guia Rápido de Comandos* ⚡️

*Venda:* \`<nome> <qtd> <produto> <preço>\`

*Clientes:*
• \`/novo <nome>\`
• \`/clientes\`
• \`/alterarnome <antigo> -> <novo>\`
• \`/excluircliente <nome>\`

*Dívidas:*
• \`/extrato <nome>\`
• \`/pago <nome>\`
• \`/divida <nome>\`

*Relatório:*
• \`/relatoriodia\`

*Ajuda completa:* \`/ajuda\``;
                await sock.sendMessage(jid, { text: menuAjudaRapido });
                break;
            
            default:
                await sock.sendMessage(jid, { text: `Comando "${comandoLower}" não reconhecido. Digite */ajuda*.` });
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
