# Caderno

Cálculos de processo e hidráulica industrial no celular, offline. São 61 módulos
em seis categorias: escoamento, bombeamento, fluidos e processos, vasos e
equipamentos, tubulação e integridade, operação/diagnóstico e utilidades.

Tudo roda no próprio navegador (JavaScript puro, sem servidor, sem coleta de dados).
Depois da primeira visita funciona sem internet, e dá para instalar na tela inicial.

**Acesse:** https://projetoindustrial.github.io/caderno/

## Aviso

Ferramenta com finalidade **didática e de estudo**. Os resultados não substituem a
responsabilidade técnica de um engenheiro habilitado (ART/RRT). Validação profissional
é obrigatória antes de qualquer uso prático.

## Instalar no celular

- **Android (Chrome):** menu ⋮ → "Adicionar à tela inicial"
- **iPhone (Safari):** compartilhar → "Adicionar à Tela de Início"

## Rodar localmente

```bash
python3 -m http.server 8000
```

Abra `http://localhost:8000`. O modo offline exige `localhost` ou HTTPS; abrir o
`index.html` direto como arquivo não ativa o service worker.

## Arquivos

```
index.html          telas dos módulos e navegação por categorias
styles.css          visual
app.js              cálculos e navegação
manifest.json       metadados de instalação
service-worker.js   cache offline (CACHE_NAME caderno-v1)
icons/              ícones do app
og-image.png        imagem de preview ao compartilhar o link
```

Ao alterar qualquer arquivo, aumente o número em `CACHE_NAME` no `service-worker.js`,
senão quem já instalou continua vendo a versão antiga.

Parte do projeto industrial, junto de [IndústriaEDU](https://projetoindustrial.github.io/industriaedu/)
e [Manutenção](https://projetoindustrial.github.io/manutencao/).
