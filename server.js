const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

let cardapio = [
  { id: 1, nome: 'Porção de Traíra Frita', preco: 65.00, categoria: 'Porções', unidade: 'UN', disponivel: true },
  { id: 2, nome: 'Porção de Batata Frita', preco: 30.00, categoria: 'Acompanhamentos', unidade: 'UN', disponivel: true },
  { id: 3, nome: 'Tilápia Fresca Limpa', preco: 35.00, categoria: 'Peixe Limpo', unidade: 'KG', disponivel: true },
  { id: 4, nome: 'Cerveja 600ml', preco: 14.00, categoria: 'Bebidas', unidade: 'UN', disponivel: true },
  { id: 5, nome: 'Refrigerante Lata', preco: 6.00, categoria: 'Bebidas', unidade: 'UN', disponivel: true }
];

let pedidos = [];
let comandas = {};
let historicoVendas = [];
let cupomAtivo = { codigo: "PESQUE10", desconto: 10 };
const PIN_VALIDO = "1234";

io.on('connection', (socket) => {
  socket.emit('atualizar_cardapio', cardapio);
  socket.emit('atualizar_pedidos', pedidos);
  socket.emit('atualizar_comandas', comandas);
  socket.emit('atualizar_historico', historicoVendas);
  socket.emit('atualizar_cupom', cupomAtivo);

  // --- ADMIN: Cardápio ---
  socket.on('adicionar_item_cardapio', (novoItem) => {
    novoItem.id = Date.now();
    novoItem.preco = parseFloat(novoItem.preco);
    novoItem.unidade = novoItem.unidade || 'UN';
    novoItem.disponivel = true;
    cardapio.push(novoItem);
    io.emit('atualizar_cardapio', cardapio);
  });

  socket.on('editar_item_cardapio', (itemAtualizado) => {
    const index = cardapio.findIndex(item => item.id == itemAtualizado.id);
    if (index !== -1) {
      cardapio[index] = {
        ...cardapio[index],
        nome: itemAtualizado.nome,
        preco: parseFloat(itemAtualizado.preco),
        categoria: itemAtualizado.categoria,
        unidade: itemAtualizado.unidade || 'UN'
      };
      io.emit('atualizar_cardapio', cardapio);
    }
  });

  socket.on('alternar_disponibilidade', (id) => {
    const item = cardapio.find(i => i.id == id);
    if (item) {
      item.disponivel = !item.disponivel;
      io.emit('atualizar_cardapio', cardapio);
    }
  });

  socket.on('remover_item_cardapio', (id) => {
    cardapio = cardapio.filter(item => item.id != id);
    io.emit('atualizar_cardapio', cardapio);
  });

  socket.on('salvar_cupom', (dadosCupom) => {
    cupomAtivo = {
      codigo: dadosCupom.codigo.toUpperCase().trim(),
      desconto: parseFloat(dadosCupom.desconto) || 0
    };
    io.emit('atualizar_cupom', cupomAtivo);
  });

  // --- LANÇAMENTOS DIRETO NO CAIXA ---
  socket.on('lançar_item_caixa', (dados) => {
    const { mesa, nomeItem, valorTotal, obs } = dados;
    const mesaStr = String(mesa).trim();
    const valorNum = parseFloat(valorTotal);

    if (!mesaStr || isNaN(valorNum)) {
      socket.emit('erro_pin', 'Dados inválidos para lançamento no caixa.');
      return;
    }

    if (!comandas[mesaStr]) {
      comandas[mesaStr] = { 
        cliente: 'Cliente Balcão/Mesa', 
        total: 0, 
        descontoTotal: 0,
        status: 'ABERTA', 
        itensConsumidos: [] 
      };
    }

    const itemNovo = { 
      id: Date.now(),
      nome: nomeItem, 
      preco: valorNum, 
      obs: obs || 'Lançado no Caixa' 
    };

    comandas[mesaStr].total += valorNum;
    comandas[mesaStr].itensConsumidos.push(itemNovo);

    io.emit('atualizar_comandas', comandas);
    socket.emit('sucesso_pedido', `Item "${nomeItem}" (R$ ${valorNum.toFixed(2)}) adicionado na Mesa ${mesaStr}!`);
  });

  // --- REMOVER ITEM DA COMANDA (Mesa/Caixa) ---
  socket.on('remover_item_comanda', ({ mesa, indexItem }) => {
    if (comandas[mesa] && comandas[mesa].itensConsumidos[indexItem]) {
      const itemRemovido = comandas[mesa].itensConsumidos[indexItem];
      
      // Subtrai o valor do item do total da comanda
      comandas[mesa].total -= parseFloat(itemRemovido.preco);
      if (comandas[mesa].total < 0) comandas[mesa].total = 0;

      // Remove o item do array
      comandas[mesa].itensConsumidos.splice(indexItem, 1);

      io.emit('atualizar_comandas', comandas);
    }
  });

  // --- PEDIDOS CLIENTE ---
  socket.on('novo_pedido', (dados) => {
    if (dados.pin !== PIN_VALIDO) {
      socket.emit('erro_pin', 'PIN da mesa incorreto!');
      return;
    }

    if (comandas[dados.mesa] && (comandas[dados.mesa].status === 'AGUARDANDO_PAGAMENTO' || comandas[dados.mesa].status === 'FECHADA')) {
      socket.emit('erro_pin', 'Esta mesa já solicitou a conta ou foi fechada.');
      return;
    }

    const agora = new Date();
    const horarioFormatado = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const pedido = {
      id: Date.now(),
      mesa: dados.mesa,
      cliente: dados.cliente,
      itens: dados.itens,
      total: dados.total,
      desconto: dados.desconto || 0,
      status: 'PENDENTE',
      horario: horarioFormatado
    };

    pedidos.push(pedido);

    if (!comandas[dados.mesa]) {
      comandas[dados.mesa] = { 
        cliente: dados.cliente, 
        total: 0, 
        descontoTotal: 0, 
        status: 'ABERTA', 
        itensConsumidos: [] 
      };
    }

    if (comandas[dados.mesa].descontoTotal === undefined) {
      comandas[dados.mesa].descontoTotal = 0;
    }

    comandas[dados.mesa].total += dados.total;
    comandas[dados.mesa].descontoTotal += (dados.desconto || 0);
    comandas[dados.mesa].itensConsumidos.push(...dados.itens);

    io.emit('atualizar_pedidos', pedidos);
    io.emit('atualizar_comandas', comandas);
    socket.emit('sucesso_pedido', 'Seu pedido foi enviado para a cozinha! 🎣');
  });

  socket.on('atualizar_status_pedido', ({ idPedido, novoStatus }) => {
    const p = pedidos.find(item => item.id == idPedido);
    if (p) {
      p.status = novoStatus;
      io.emit('atualizar_pedidos', pedidos);
    }
  });

  socket.on('solicitar_fechamento', ({ mesa, formaPagamento }) => {
    if (!comandas[mesa]) {
      comandas[mesa] = { cliente: 'Cliente', total: 0, descontoTotal: 0, status: 'AGUARDANDO_PAGAMENTO', itensConsumidos: [] };
    } else {
      comandas[mesa].status = 'AGUARDANDO_PAGAMENTO';
    }
    comandas[mesa].formaPagamento = formaPagamento || 'PIX';
    io.emit('atualizar_comandas', comandas);
  });

  socket.on('encerrar_mesa', (mesa) => {
    if (comandas[mesa]) {
      const c = comandas[mesa];
      historicoVendas.push({
        id: Date.now(),
        mesa: mesa,
        cliente: c.cliente,
        total: c.total,
        descontoTotal: c.descontoTotal || 0,
        formaPagamento: c.formaPagamento || 'Balcão',
        itens: c.itensConsumidos,
        dataHora: new Date().toLocaleString('pt-BR')
      });

      comandas[mesa].status = 'FECHADA';
      pedidos = pedidos.filter(p => p.mesa !== mesa);

      io.emit('atualizar_pedidos', pedidos);
      io.emit('atualizar_comandas', comandas);
      io.emit('atualizar_historico', historicoVendas);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});