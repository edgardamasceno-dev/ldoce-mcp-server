# Ldoce MCP Server

Este é um MCP server desenvolvido em Node.js e TypeScript que consome a página do Longman Dictionary para uma determinada palavra e retorna os dados extraídos no formato JSON padronizado para uso por agentes de IA.

## Descrição

O servidor se conecta à URL `https://www.ldoceonline.com/dictionary/<word>`, extrai informações como a introdução, tópicos relacionados, entradas (verb e noun), corpus examples e origem, e retorna esses dados estruturados em um objeto JSON. O projeto segue os padrões do Model Context Protocol (MCP) e utiliza os pacotes Axios e Cheerio para requisições HTTP e parsing de HTML.

## Recursos

- **Extrai informações do Longman Dictionary:**
  - Introdução e tópicos relacionados
  - Entradas com detalhes de pronúncias, sentidos, exemplos, etc.
  - Corpus examples
  - Origem da palavra

- **Utiliza MCP SDK para expor uma ferramenta** que pode ser integrada a clientes MCP, como o Claude Desktop.

## Pré-requisitos

- Node.js (versão 16 ou superior)
- npm
- Git

## Instalação

1. Clone o repositório:
   ```bash
   git clone https://github.com/seuusuario/ldoce-mcp-server.git
   cd ldoce-mcp-server