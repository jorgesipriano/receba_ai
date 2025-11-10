import db from './database.js';
import fs from 'fs';

// --- CONFIGURAÇÃO ---
// !!! IMPORTANTE !!!
// Coloque aqui o ID da conta do bar para o qual você quer importar os dados.
// Você pode encontrar este ID na sua tabela 'contas' no site do Supabase. É um número.
const ID_DA_CONTA_DO_BAR = '61cd3228-18fa-48d3-9cc0-dc1f81b2c3ea'; // <--- TROQUE ESTE NÚMERO PELO ID DO SEU BAR

async function importar() {
    console.log('--- Iniciando script de importação ---');

    if (ID_DA_CONTA_DO_BAR === null || ID_DA_CONTA_DO_BAR === 0 || ID_DA_CONTA_DO_BAR === 'TROQUE ESTE NÚMERO') {
        console.error('\n❌ ERRO: Você precisa definir o ID_DA_CONTA_DO_BAR no topo do script antes de executar!');
        return;
    }
    console.log(`Importando dados para a conta de ID: ${ID_DA_CONTA_DO_BAR}`);

    // 1. Ler o arquivo JSON que você preparou
    let dados;
    try {
        const rawData = fs.readFileSync('./dados_antigos.json');
        dados = JSON.parse(rawData);
    } catch (error) {
        console.error('\n❌ ERRO: Não foi possível ler o arquivo "dados_antigos.json".');
        console.error('Verifique se o arquivo existe na mesma pasta e se o conteúdo JSON está correto (sem vírgulas sobrando, etc).');
        return;
    }

    console.log(`✅ Arquivo JSON lido com sucesso. Encontrados ${dados.length} clientes para importar.`);

    // 2. Loop através de cada cliente do arquivo
    for (const clienteData of dados) {
        const nomeCliente = clienteData.nomeCliente;
        console.log(`\n-----------------------------------\n🔄 Processando cliente: ${nomeCliente}`);

        // 3. Verifica se o cliente já existe ou cria um novo
        let cliente = await db.encontrarClientePorNome(nomeCliente, ID_DA_CONTA_DO_BAR);
        if (!cliente) {
            console.log(`  -> Cliente não encontrado. Criando novo cliente...`);
            await db.adicionarCliente(nomeCliente, ID_DA_CONTA_DO_BAR);
            cliente = await db.encontrarClientePorNome(nomeCliente, ID_DA_CONTA_DO_BAR);
            
            if (!cliente) {
                console.error(`  -> ❌ ERRO FATAL: Falha ao criar e re-buscar o cliente ${nomeCliente}. Abortando.`);
                return;
            }
            console.log(`  -> ✅ Cliente "${nomeCliente}" criado com ID: ${cliente.id}`);
        } else {
            console.log(`  -> 👤 Cliente "${nomeCliente}" já existe com ID: ${cliente.id}. Apenas adicionando vendas...`);
        }

        // 4. Loop através das vendas do cliente e insere cada uma no banco
        let vendasImportadas = 0;
        for (const venda of clienteData.vendas) {
            const valorTotal = venda.quantidade * venda.valorUnitario;
            
            await db.adicionarVenda({
                clienteId: cliente.id,
                quantidade: venda.quantidade,
                valorUnitario: venda.valorUnitario,
                valorTotal: valorTotal,
                descricaoProduto: venda.produto,
                contaId: ID_DA_CONTA_DO_BAR,
                dataVenda: venda.data // Passando a data histórica da venda
            });
            vendasImportadas++;
        }
        console.log(`  -> 🛒 ${vendasImportadas} vendas importadas para ${nomeCliente}.`);
    }

    console.log('\n-----------------------------------');
    console.log('🚀 Importação Concluída com Sucesso! 🚀');
    console.log('Verifique os dados no seu painel do Supabase e teste no bot com os comandos /clientes e /extrato.');
}

importar();
