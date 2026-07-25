const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir os arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// --- BANCO DE DADOS EM MEMÓRIA (Para o MVP) ---
const PIN_SEGURANCA = "1234"; // PIN simples para validar a mesa
let comandas = {}; // Guarda as comandas por mesa ex: { 5: { cliente: "João", status: "ABERTA", total: 0 } }
let pedidos = [];  // Lista de todos os pedidos realizados no dia
let idPedidoCount = 1;

// --- COMUNICAÇÃO EM TEMPO REAL (Socket.io) ---
io.on('connection', (socket) => {
  console.log('🔌 Novo dispositivo conectado:', socket.id);

  // Envia o estado atual para quem acabou de se conectar
  socket.emit('atualizar_pedidos', pedidos);
  socket.emit('atualizar_comandas', comandas);

  // 1. NOVO PEDIDO DO CLIENTE
  socket.on('novo_pedido', (dados) => {
    // Validação básica do PIN
    if (dados.pin !== PIN_SEGURANCA) {
      socket.emit('erro_pin', 'PIN da mesa incorreto!');
      return;
    }

    const { mesa, cliente, itens, total } = dados;

    // Se a mesa ainda não existe nas comandas, cria uma
    if (!comandas[mesa] || comandas[mesa].status === 'FECHADA') {
      comandas[mesa] = {
        cliente: cliente,
        status: 'ABERTA',
        total: 0
      };
    }

    // Cria o objeto do pedido
    const pedido = {
      id: idPedidoCount++,
      mesa: Number(mesa),
      cliente: cliente,
      itens: itens,
      total: Number(total),
      status: 'PENDENTE', // PENDENTE -> EM_PREPARO -> CONCLUIDO -> ENTREGUE
      horario: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };

    // Atualiza o total da comanda da mesa
    comandas[mesa].total += pedido.total;
    pedidos.push(pedido);

    // Notifica TODOS os painéis conectados instantaneamente!
    io.emit('atualizar_pedidos', pedidos);
    io.emit('atualizar_comandas', comandas);
    socket.emit('sucesso_pedido', 'Pedido enviado com sucesso!');
  });

  // 2. MUDANÇA DE STATUS (Cozinha e Entregador)
  socket.on('atualizar_status_pedido', ({ idPedido, novoStatus }) => {
    const pedido = pedidos.find(p => p.id === idPedido);
    if (pedido) {
      pedido.status = novoStatus;
      io.emit('atualizar_pedidos', pedidos);
    }
  });

  // 3. FECHAMENTO DE CONTA (Cliente solicita)
  socket.on('solicitar_fechamento', ({ mesa, formaPagamento }) => {
    if (comandas[mesa]) {
      comandas[mesa].status = 'AGUARDANDO_PAGAMENTO';
      comandas[mesa].formaPagamento = formaPagamento;
      io.emit('atualizar_comandas', comandas);
    }
  });

  // 4. ENCERRAR CONTA (Caixa confirma e libera a mesa)
  socket.on('encerrar_mesa', (mesa) => {
    if (comandas[mesa]) {
      comandas[mesa].status = 'FECHADA';
      // Limpa os pedidos dessa mesa
      pedidos = pedidos.filter(p => p.mesa !== Number(mesa));
      io.emit('atualizar_pedidos', pedidos);
      io.emit('atualizar_comandas', comandas);
    }
  });
});

// Inicialização do servidor na porta 3000
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});