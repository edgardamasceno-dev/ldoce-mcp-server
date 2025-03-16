#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Estruturas de dados finais (semelhantes às que você pediu)
 */

// Exemplo de JSON final:
//
// {
//   "dictionaryEntries": [ ... ],
//   "simpleForm": { ... },
//   "continuousForm": { ... }
// }

interface DictionaryExample {
  text: string;
  audioUrl?: string;
}

interface DictionarySense {
  number?: number;
  grammar?: string;
  activation?: string;
  definition?: string | { text: string; url: string };
  examples?: DictionaryExample[];
}

interface DictionaryParsedEntry {
  word: string;           // ex.: "rot"
  pronunciation: string;  // ex.: "/rɒt/ (US: rɑːt)"
  partOfSpeech: string;   // ex.: "verb", "noun", etc.
  inflections: string[];  // ex.: ["rotted", "rotting"]
  relatedTopics: string[]; // ex.: ["Biology"]
  senses: DictionarySense[];
}

interface ConjugationTable {
  [tense: string]: {
    [subject: string]: string;
  };
}

interface FinalDictionaryJson {
  dictionaryEntries: DictionaryParsedEntry[];
  simpleForm: ConjugationTable;
  continuousForm: ConjugationTable;
}

/** 
 * Função principal que extrai e retorna o JSON final 
 * conforme o formato solicitado.
 */
async function fetchDictionaryData(word: string): Promise<FinalDictionaryJson> {
  const url = `https://www.ldoceonline.com/dictionary/${encodeURIComponent(word)}`;

  const { data: html } = await axios.get(url, {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MCP-Server/0.1.0)',
    },
  });

  const $ = cheerio.load(html);

  // ==========================
  // 1) Extrair .dictentry (as entradas do dicionário)
  // ==========================
  const dictionaryEntries: DictionaryParsedEntry[] = [];
  
  // Para cada <span class="dictentry">...
  $('span.dictentry').each((_, dictentryEl) => {
    const dictentry = $(dictentryEl);

    // Dentro dele, encontramos .ldoceEntry.Entry
    const ldoceEntryEl = dictentry.find('.ldoceEntry.Entry').first();
    if (!ldoceEntryEl || ldoceEntryEl.length === 0) {
      return; // pula se não achar
    }

    // Extrair "relatedTopics"
    const relatedTopics: string[] = [];
    ldoceEntryEl.find('.topics_container a.topic').each((_, topicEl) => {
      relatedTopics.push($(topicEl).text().trim());
    });

    // Extrair "head" (palavra, pronúncia, etc.)
    // Pode ser .frequent.Head ou .Head
    const headEl = ldoceEntryEl.find('.frequent.Head, .Head').first();
    const extractedWord = headEl.find('.HWD').text().trim() || word;
    const hyphenation = headEl.find('.HYPHENATION').text().trim() || '';
    const homnum = headEl.find('.HOMNUM').text().trim() || '';
    const pos = headEl.find('.POS').text().trim() || '';
    
    // Pronúncia britânica e americana
    const brit = headEl.find('span.brefile').attr('data-src-mp3');
    const ame = headEl.find('span.amefile').attr('data-src-mp3');

    // Ou extrair do .PronCodes:
    let textPron = '';
    const pronCodes = headEl.find('.PronCodes').first();
    if (pronCodes && pronCodes.length > 0) {
      // Montamos algo tipo "/rɒt/ (US: rɑːt)"
      const pronSpans = pronCodes.find('span.PRON, span.AMEVARPRON, span.neutral');
      let collected = '';
      pronSpans.each((i, elSpan) => {
        collected += $(elSpan).text();
      });
      textPron = collected.trim();
    }

    // Se preferir simplificar: "/rɒt/ (US: rɑːt)"
    // ex: textPron = "/rɒt/ $ rɑːt/"
    // convert $ -> (US:)
    textPron = textPron.replace(/\s*\$\s*/g, '(US: ').replace(/\/\s*$/, '/)').replace(/\)\)/, ')');
    if (!textPron.includes('(US:') && textPron.endsWith('/)')) {
      textPron = textPron.replace('/)', '/');
    }

    // Inflections (ex. (rotted, rotting))
    const inflectionsText = headEl.find('.Inflections').text().trim();
    // ex. "(rotted, rotting)"
    let inflections: string[] = [];
    if (inflectionsText) {
      // remove parênteses
      const inf = inflectionsText.replace(/[()]/g, '');
      // separa por vírgula
      inflections = inf.split(',').map(s => s.trim()).filter(Boolean);
    }

    // 2) Extrair "senses"
    const senses: DictionarySense[] = [];
    ldoceEntryEl.find('.Sense').each((_, senseEl) => {
      const sense = $(senseEl);
      const number = Number.parseInt(sense.find('.sensenum').first().text().trim(), 10) || undefined;
      const grammar = sense.find('.GRAM').text().trim() || undefined;
      const activation = sense.find('.ACTIV').text().trim() || undefined;

      // "Definition" pode ser um texto normal ou algo do tipo "(→ rot in hell/jail)"
      const definitionText = sense.find('.DEF').text().trim();
      let definitionObj: string | { text: string; url: string } = definitionText;

      // Se a definition for algo tipo "(→ rot in hell/jail)",
      // transformamos em { text: "🔗 rot in hell/jail", url: ... }
      // Precisamos ver se há link .Crossref ou algo do tipo
      if (!definitionText && sense.find('.Crossref a').length > 0) {
        // ex: "rot in hell/jail"
        const crossLink = sense.find('.Crossref a').first();
        const crossText = crossLink.text().trim();
        const crossHref = crossLink.attr('href');
        if (crossText && crossHref) {
          definitionObj = {
            text: `🔗 ${crossText}`,
            url: `https://www.ldoceonline.com${crossHref}`
          };
        }
      }

      // se for algo como a .DEF vem só com → e link
      // ex: " → rot in hell/jail"
      if (definitionText.startsWith('→')) {
        // Tentar extrair a link
        const crossLink = sense.find('.Crossref a').first();
        if (crossLink && crossLink.length > 0) {
          const crossText = crossLink.text().trim();
          const crossHref = crossLink.attr('href');
          definitionObj = {
            text: `🔗 ${crossText}`,
            url: `https://www.ldoceonline.com${crossHref}`
          };
        } else {
          definitionObj = definitionText;
        }
      }

      // Se a .DEF tiver link <a>, substituímos trechos "decay" e "gradual" etc?
      // Faremos simples, manteremos o text.
      // 3) Extrair EXAMPLE
      const examples: DictionaryExample[] = [];
      sense.find('.EXAMPLE').each((_, exEl) => {
        const ex = $(exEl);
        const text = ex.text().trim();
        // pegar audio se houver
        let audioUrl = ex.find('.speaker.exafile').attr('data-src-mp3');
        if (!audioUrl) {
          // ou exafile
          audioUrl = ex.find('.speaker').attr('data-src-mp3') || undefined;
        }
        examples.push({
          text,
          audioUrl
        });
      });

      senses.push({
        number,
        grammar: grammar || undefined,
        activation: activation || undefined,
        definition: definitionObj,
        examples
      });
    });

    dictionaryEntries.push({
      word,
      pronunciation: textPron || '',
      partOfSpeech: pos || '',
      inflections,
      relatedTopics,
      senses
    });
  });

  // ==========================
  // 3) Extrair a Tabela (Verb table) -> simpleForm e continuousForm
  // ==========================
  // A tabela fica dentro de <div class="verbTable"> no snippet.
  // Precisamos de .simpleForm e .continuousForm
  const simpleForm: ConjugationTable = {};
  const continuousForm: ConjugationTable = {};

  // Achar <div class="verbTable">
  const verbTableEl = $('.verbTable').first();
  if (verbTableEl && verbTableEl.length > 0) {
    // ============ SIMPLE FORM ============
    const simpleFormEl = verbTableEl.find('table.simpleForm').first();
    if (simpleFormEl && simpleFormEl.length > 0) {
      parseConjugationTable(simpleFormEl, simpleForm);
    }

    // ============ CONTINUOUS FORM ============
    const continuousFormEl = verbTableEl.find('table.continuousForm').first();
    if (continuousFormEl && continuousFormEl.length > 0) {
      parseConjugationTable(continuousFormEl, continuousForm);
    }
  }

  // Montamos o objeto final
  const finalJson: FinalDictionaryJson = {
    dictionaryEntries,
    simpleForm,
    continuousForm
  };

  return finalJson;
}

/**
 * Função auxiliar que extrai as conjugações de um <table> (ex.: "simpleForm")
 * e preenche o objeto de forma { Tense: { "I / you / we / they": "rot", ... } }
 */
/**
 * Função auxiliar que extrai as conjugações de um <table> (ex.: "simpleForm")
 * e preenche o objeto de forma { Tense: { "I / you / we / they": "rot", ... } }
 */
function parseConjugationTable(
    tableEl: cheerio.Cheerio,
    tableObj: ConjugationTable
  ) {
    const $table = cheerio.load(tableEl.html() || '');
    let currentTense = ''; // Ex.: "Present", "Past", etc.
  
    $table('tr').each((_, trEl) => {
      const tr = $table(trEl);
  
      // Verifica se é um header
      const header = tr.find('td.header').text().trim();
      if (header) {
        return;
      }
  
      if (tr.find('td.view_more, td.view_less').length > 0) {
        return;
      }
  
      // Se tiver <td class="col1">, assumimos que é um Tense
      const col1Value = tr.find('td.col1').text().trim();
      if (col1Value) {
        currentTense = col1Value;
        if (!tableObj[currentTense]) {
          tableObj[currentTense] = {};
        }
        return;
      }
  
      // senão, pegamos as colunas .col2 e interpretamos "subject" e "verbForm"
      const col2First = tr.find('td.firsts.col2, td.col2').first();
      const subject = col2First.text().trim();
  
      const col2Second = tr.find('td.col2').last();
      const verbForm = col2Second.text().trim();
  
      // Armazenamos no objeto
      if (currentTense && subject) {
        tableObj[currentTense][subject] = verbForm;
      }
    });
  }

/* =======================
   MCP Server
   ======================= */
class LdoceMcpServer {
  private server: Server;

  constructor() {
    console.error('[Setup] Initializing MCP server with JSON output...');
    this.server = new Server(
      {
        name: 'ldoce-json-server',
        id: 'ldoce-json-server',
        version: '0.1.0',
      },
      { capabilities: { tools: {} } }
    );

    this.setupToolHandlers();
    this.server.onerror = (error) => console.error('[Error]', error);
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    this.server.onclose = (error?: any) => {
      console.error('[Server] Connection closed', error);
      process.exit(0);
    };
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private async setupToolHandlers() {
    // Handler para listar as ferramentas disponíveis
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_dictionary_entry',
          description: 'Busca o HTML do Longman para uma palavra e retorna JSON parseado (dictionaryEntries, simpleForm, continuousForm)',
          inputSchema: {
            type: 'object',
            properties: {
              word: {
                type: 'string',
                description: 'A palavra a ser consultada (ex: rot)',
              },
            },
            required: ['word'],
          },
        },
      ],
    }));

    // Handler para a ferramenta get_dictionary_entry
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        if (request.params.name !== 'get_dictionary_entry') {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        }
        const args = request.params.arguments as { word: string };
        if (!args.word) {
          throw new McpError(ErrorCode.InvalidParams, '"word" parameter is required.');
        }

        console.error(`[API] Searching dictionary data for word: ${args.word}`);

        // Busca o JSON extraído
        const finalJson = await fetchDictionaryData(args.word);

        // Retorna no "content" do MCP
        // Observação: finalJson é objeto, precisamos serializar para string
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(finalJson, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        if (error instanceof Error) {
          console.error('[Error] Failed to fetch entry:', error.message);
          throw new McpError(ErrorCode.InternalError, `Falha ao buscar a entrada: ${error.message}`);
        }
        console.error('[Error] Unknown error occurred');
        throw new McpError(ErrorCode.InternalError, 'Falha ao buscar a entrada: Unknown error');
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Ldoce JSON server running via stdio');
  }
}

// Executar o servidor
const serverInstance = new LdoceMcpServer();
serverInstance.run().catch(console.error);
