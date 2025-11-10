import express from 'express';

const app = express();
const PORT = 3003;

app.use(express.static('public'));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor de teste rodando na porta ${PORT}`);
});
