import { supabase } from './supabaseClient.js';

// --- FUNÇÃO AUXILIAR DE NORMALIZAÇÃO ---
function normalizarString(texto) {
    if (!texto) return '';
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// --- Funções de Contas (SaaS) ---
async function encontrarContaPorGrupoId(grupoId) {
    const { data, error } = await supabase.from('contas').select('*').eq('grupo_id_whatsapp', grupoId).single();
    if (error && error.code !== 'PGRST116') console.error('Erro:', error);
    return data;
}

// --- Funções de Clientes ---
async function adicionarCliente(nome, contaId) {
    const nomeNormalizado = normalizarString(nome);
    const { data: clienteExistente } = await supabase.from('clientes').select('id').eq('nome_normalizado', nomeNormalizado).eq('conta_id', contaId).maybeSingle();
    if (clienteExistente) {
        const { data: clienteData } = await supabase.from('clientes').select('*').eq('id', clienteExistente.id).single();
        return { success: false, reason: 'duplicate', cliente: clienteData };
    }
    const { data, error } = await supabase.from('clientes').insert({ nome, nome_normalizado: nomeNormalizado, conta_id: contaId }).select().single();
    if (error) throw error;
    return { success: true, cliente: data, message: `✅ Cliente "*${nome}*" cadastrado com sucesso!` };
}

async function excluirCliente(clienteId, contaId) {
    try {
        await supabase.from('vendas').delete().eq('cliente_id', clienteId).eq('conta_id', contaId);
        await supabase.from('clientes').delete().eq('id', clienteId).eq('conta_id', contaId);
        return { success: true };
    } catch (error) {
        console.error("Erro ao excluir cliente:", error);
        return { success: false, error };
    }
}

async function buscarClientePorNome(nome, contaId) {
    const nomeNormalizado = normalizarString(nome);
    const { data, error } = await supabase.from('clientes').select('*').eq('nome_normalizado', nomeNormalizado).eq('conta_id', contaId).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
}

async function buscarClientesSimilares(nome, contaId) {
    const nomeTratado = nome.trim().split(' ')[0];
    const nomeNormalizado = normalizarString(nomeTratado);
    const { data, error } = await supabase.from('clientes').select('id, nome').ilike('nome_normalizado', `%${nomeNormalizado}%`).eq('conta_id', contaId).limit(3);
    if (error) throw error;
    return data || [];
}

async function listarTodosClientes(contaId) {
    const { data, error } = await supabase.from('clientes').select('id, nome').eq('conta_id', contaId).order('nome');
    if (error) throw error;
    return data || [];
}

// --- Funções de Vendas ---
async function adicionarVenda(venda) {
    const { error } = await supabase.from('vendas').insert(venda);
    if (error) throw error;
}

async function calcularDividaTotal(clienteId, contaId) {
    const { data, error } = await supabase.from('vendas').select('valor_total').eq('cliente_id', clienteId).eq('conta_id', contaId).eq('pago', false);
    if (error) return 0;
    return data.reduce((acc, item) => acc + item.valor_total, 0);
}

async function calcularDividaGeral(contaId) {
    const { data, error } = await supabase.from('vendas').select('valor_total').eq('conta_id', contaId).eq('pago', false);
    if (error) return 0;
    return data.reduce((acc, item) => acc + item.valor_total, 0);
}

async function quitarDivida(clienteId, contaId) {
    const { error } = await supabase.from('vendas').update({ pago: true }).eq('cliente_id', clienteId).eq('conta_id', contaId).eq('pago', false);
    return !error;
}

async function gerarExtrato(clienteId, contaId) {
    const { data, error } = await supabase.from('vendas').select('*').eq('cliente_id', clienteId).eq('conta_id', contaId).eq('pago', false).order('created_at');
    if (error) throw error;
    return data || [];
}

// --- NOVAS FUNÇÕES DE RELATÓRIO ---
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
    const clientes = await listarTodosClientes(contaId);
    if (!clientes || clientes.length === 0) return [];
    const dividasPromises = clientes.map(async (cliente) => {
        const dividaTotal = await calcularDividaTotal(cliente.id, contaId);
        return { nome: cliente.nome, divida: dividaTotal };
    });
    const clientesComDivida = await Promise.all(dividasPromises);
    return clientesComDivida.filter(c => c.divida > 0).sort((a, b) => b.divida - a.divida).slice(0, limite);
}

// --- EXPORTAÇÃO COMPLETA ---
export default {
    encontrarContaPorGrupoId,
    adicionarCliente,
    buscarClientePorNome,
    buscarClientesSimilares,
    listarTodosClientes,
    excluirCliente,
    adicionarVenda,
    calcularDividaTotal,
    calcularDividaGeral,
    quitarDivida,
    gerarExtrato,
    gerarRelatorioVendas,
    buscarDividasAntigas,
    rankingMaioresDividas
};
