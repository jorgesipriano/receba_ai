import { supabase } from './supabaseClient.js';
// Importa funções do "Chef Principal" (database.js) que são necessárias aqui
import db from './database.js';

// --- FUNÇÕES DE RELATÓRIO E RANKING ---

async function gerarRelatorioVendas(contaId, dataInicio, dataFim) {
    const { data, error } = await supabase.from('vendas')
        .select('*')
        .eq('conta_id', contaId)
        .gte('created_at', dataInicio.toISOString())
        .lt('created_at', dataFim.toISOString());
    if (error) throw error;
    return data || [];
}

async function buscarDividasAntigas(contaId, dias = 30) {
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - dias);
    
    const { data, error } = await supabase
        .from('vendas')
        .select(`*, clientes!inner(nome)`)
        .eq('conta_id', contaId)
        .eq('pago', false)
        .lt('created_at', dataLimite.toISOString());

    if (error) {
        console.error("Erro ao buscar dívidas antigas:", error);
        throw error;
    }

    const dividasPorCliente = data.reduce((acc, venda) => {
        const nomeCliente = venda.clientes.nome;
        if (!acc[nomeCliente]) {
            acc[nomeCliente] = 0;
        }
        acc[nomeCliente] += venda.valor_total;
        return acc;
    }, {});

    return Object.entries(dividasPorCliente).map(([nome, divida]) => ({ nome, divida }));
}

async function rankingMaioresDividas(contaId, limite = 3) {
    const clientes = await db.listarTodosClientes(contaId);
    if (!clientes || clientes.length === 0) return [];
    const dividasPromises = clientes.map(async (cliente) => {
        const dividaTotal = await db.calcularDividaTotal(cliente.id, contaId);
        return { nome: cliente.nome, divida: dividaTotal };
    });
    const clientesComDivida = await Promise.all(dividasPromises);
    return clientesComDivida.filter(c => c.divida > 0).sort((a, b) => b.divida - a.divida).slice(0, limite);
}

async function gerarRelatorioFechamentoDia(contaId) {
    const hoje = new Date();
    const inicioDoDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0, 0).toISOString();
    const fimDoDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59, 999).toISOString();

    const { data: vendas, error } = await supabase.from('vendas')
        .select('valor_total, clientes(nome)')
        .eq('conta_id', contaId)
        .gte('created_at', inicioDoDia)
        .lt('created_at', fimDoDia);

    if (error) throw error;
    if (!vendas) return null;

    const totalVendido = vendas.filter(v => v.valor_total > 0).reduce((acc, v) => acc + v.valor_total, 0);
    const totalRecebido = vendas.filter(v => v.valor_total < 0).reduce((acc, p) => acc + Math.abs(p.valor_total), 0);
    
    const clientesComMovimento = vendas.filter(v => v.valor_total > 0).reduce((acc, v) => {
        const nome = v.clientes?.nome || 'Cliente avulso';
        acc[nome] = (acc[nome] || 0) + v.valor_total;
        return acc;
    }, {});

    return { totalVendido, totalRecebido, clientesFiado: Object.entries(clientesComMovimento) };
}

// --- FUNÇÕES ADICIONADAS QUE ESTAVAM FALTANDO ---

async function gerarDadosRelatorioSemanal(contaId) {
    const hoje = new Date();
    const fimSemana = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1, 23, 59, 59, 999);
    const inicioSemana = new Date(fimSemana.getFullYear(), fimSemana.getMonth(), fimSemana.getDate() - 6, 0, 0, 0);
    
    const { data: vendasSemana, error } = await supabase.from('vendas')
        .select('valor_total')
        .eq('conta_id', contaId)
        .gte('created_at', inicioSemana.toISOString())
        .lt('created_at', fimSemana.toISOString());

    if (error) throw error;

    const totalVendido = (vendasSemana || []).filter(v => v.valor_total > 0).reduce((acc, v) => acc + v.valor_total, 0);
    const dividaTotalAtual = await db.calcularDividaGeral(contaId);
    const dividasAntigas = await buscarDividasAntigas(contaId, 30);

    return {
        periodo: `${inicioSemana.toLocaleDateString('pt-BR')} - ${fimSemana.toLocaleDateString('pt-BR')}`,
        totalVendido,
        dividaTotalAtual,
        dividasAntigasCount: dividasAntigas.length
    };
}

async function gerarDadosRelatorioMensal(contaId) {
    const hoje = new Date();
    const fimMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23, 59, 59, 999);
    const inicioMesAnterior = new Date(fimMesAnterior.getFullYear(), fimMesAnterior.getMonth(), 1, 0, 0, 0);

    const { data: vendasMes, error } = await supabase.from('vendas')
        .select('valor_total, clientes(nome)')
        .eq('conta_id', contaId)
        .gte('created_at', inicioMesAnterior.toISOString())
        .lt('created_at', fimMesAnterior.toISOString());

    if (error) throw error;

    const vendasPositivas = (vendasMes || []).filter(v => v.valor_total > 0);
    const totalFaturado = vendasPositivas.reduce((acc, v) => acc + v.valor_total, 0);
    
    const clientesDoMes = vendasPositivas.reduce((acc, v) => {
        const nome = v.clientes?.nome || 'Cliente avulso';
        acc[nome] = (acc[nome] || 0) + v.valor_total;
        return acc;
    }, {});
    
    const melhoresClientes = Object.entries(clientesDoMes).sort((a, b) => b[1] - a[1]).slice(0, 3);

    return {
        mes: inicioMesAnterior.toLocaleString('pt-BR', { month: 'long', year: 'numeric' }),
        totalFaturado,
        numVendas: vendasPositivas.length,
        melhoresClientes,
    };
}

// --- BLOCO DE EXPORTAÇÃO CORRIGIDO ---
export default {
    gerarRelatorioVendas,
    buscarDividasAntigas,
    rankingMaioresDividas,
    gerarRelatorioFechamentoDia,
    gerarDadosRelatorioSemanal,
    gerarDadosRelatorioMensal
};
