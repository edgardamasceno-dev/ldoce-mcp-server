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

/* Interfaces para o formato do JSON */

export interface Audio {
  text?: string;
  audioUrl: string | null;
}

export interface Example {
  text: string;
  audioUrl: string | null;
}

export interface Sense {
  number: number;
  grammar?: string;
  field?: string;
  activation?: string;
  definition?: string;
  examples?: Example[];
  reference?: string;
  colloquialExamples?: Example[];
  register?: string;
  example?: Example;
}

export interface Header {
  word: string;
  hyphenation: string;
  homographNumber: string;
  partOfSpeech: string;
  inflections?: string[];
}

export interface Pronunciations {
  british: Audio;
  american: Audio;
}

export interface EntryDetail {
  id: string;
  type: string;
  header: Header;
  pronunciations: Pronunciations;
  senses: Sense[];
}

export interface CorpusExampleGroup {
  group: string;
  examples: string[];
}

export interface Origin {
  word: string;
  originId: string;
  language: string;
  form: string;
}

export interface DictionaryEntry {
  word: string;
  introduction: string;
  relatedTopics: string[];
  entries: EntryDetail[];
  corpusExamples: CorpusExampleGroup[];
  origin: Origin;
}

/**
 * Busca e extrai informações do Longman Dictionary para uma determinada palavra.
 * Inclui a extração dos corpus examples a partir do HTML.
 * @param word Palavra a ser consultada.
 * @returns Uma Promise com a entrada do dicionário no formato JSON.
 */
export async function fetchDictionaryEntry(word: string): Promise<DictionaryEntry> {
  const url = `https://www.ldoceonline.com/dictionary/${encodeURIComponent(word)}`;
  
  // Requisição HTTP com timeout e cabeçalhos que simulam um navegador
  const { data: html } = await axios.get(url, {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MCP-Server/0.1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });
  
  const $ = cheerio.load(html);
  const dictionaryDiv = $('div.dictionary');
  
  // Extração da introdução
  const introduction = dictionaryDiv.find('span.dictionary_intro').first().text().trim();
  
  // Extração dos tópicos relacionados
  const relatedTopics: string[] = [];
  dictionaryDiv.find('span.related_topics + a.topic').each((_, element) => {
    relatedTopics.push($(element).text().trim());
  });

  // EXTRAÇÃO DAS ENTRADAS
  const entries: EntryDetail[] = [];
  const dictEntries = dictionaryDiv.find('span.dictentry');

  // Função auxiliar para extrair objeto Audio a partir de um seletor HTML
  const extractAudio = (htmlString: string): Audio => {
    const el = cheerio.load(htmlString)('body').children().first();
    return {
      text: el.text().trim() || undefined,
      audioUrl: el.attr('data-src-mp3') || null,
    };
  };

  // Processa a primeira entrada (ex.: verbo)
  const entryVerbEl = dictEntries.eq(0);
  if (entryVerbEl) {
    const header: Header = {
      word: entryVerbEl.find('.HWD').first().text().trim() || word,
      hyphenation: entryVerbEl.find('.HYPHENATION').first().text().trim() || word,
      homographNumber: entryVerbEl.find('.HOMNUM').first().text().trim() || '1',
      partOfSpeech: entryVerbEl.find('.POS').first().text().trim() || 'verb',
      inflections: (() => {
        const infText = entryVerbEl.find('.Inflections').first().text().replace(/[()]/g, '').trim();
        return infText ? infText.split(',').map(s => s.trim()) : [];
      })(),
    };

    const pronunciations: Pronunciations = {
      british: extractAudio(entryVerbEl.find('span.brefile').first().toString()),
      american: extractAudio(entryVerbEl.find('span.amefile').first().toString()),
    };

    const senses: Sense[] = [];
    entryVerbEl.find('span.Sense').each((i, elem) => {
      const senseEl = $(elem);
      const number = Number.parseInt(senseEl.find('.sensenum').first().text().trim()) || i + 1;
      const definition = senseEl.find('.DEF').first().text().trim();
      const examples: Example[] = [];
      senseEl.find('span.EXAMPLE').each((_, ex) => {
        const exEl = $(ex);
        examples.push({
          text: exEl.text().trim(),
          audioUrl: exEl.find('span.speaker').attr('data-src-mp3') || null,
        });
      });
      const reference = senseEl.find('.Crossref a').first().text().trim() || undefined;
      const colloquialExamples: Example[] = [];
      senseEl.find('.ColloExa').each((_, colEx) => {
        const colEl = $(colEx);
        colloquialExamples.push({
          text: colEl.find('.COLLO').text().trim(),
          audioUrl: null,
        });
      });
      senses.push({
        number,
        definition,
        examples,
        reference,
        colloquialExamples: colloquialExamples.length > 0 ? colloquialExamples : undefined,
      });
    });

    const entry1: EntryDetail = {
      id: `${word}__1`,
      type: 'verb',
      header,
      pronunciations,
      senses,
    };
    entries.push(entry1);
  }

  // Processa a segunda entrada (ex.: substantivo)
  const entryNounEl = dictEntries.eq(1);
  if (entryNounEl) {
    const header: Header = {
      word: entryNounEl.find('.HWD').first().text().trim() || word,
      hyphenation: entryNounEl.find('.HYPHENATION').first().text().trim() || word,
      homographNumber: entryNounEl.find('.HOMNUM').first().text().trim() || '2',
      partOfSpeech: entryNounEl.find('.POS').first().text().trim() || 'noun',
    };

    const pronunciations: Pronunciations = {
      british: extractAudio(entryNounEl.find('span.brefile').first().toString()),
      american: extractAudio(entryNounEl.find('span.amefile').first().toString()),
    };

    const senses: Sense[] = [];
    entryNounEl.find('span.Sense').each((i, elem) => {
      const senseEl = $(elem);
      const number = Number.parseInt(senseEl.find('.sensenum').first().text().trim()) || i + 1;
      const definition = senseEl.find('.DEF').first().text().trim();
      const examples: Example[] = [];
      senseEl.find('span.EXAMPLE').each((_, ex) => {
        const exEl = $(ex);
        examples.push({
          text: exEl.text().trim(),
          audioUrl: exEl.find('span.speaker').attr('data-src-mp3') || null,
        });
      });
      senses.push({
        number,
        definition,
        examples,
      });
    });

    const entry2: EntryDetail = {
      id: `${word}__3`,
      type: 'noun',
      header,
      pronunciations,
      senses,
    };
    entries.push(entry2);
  }

  // EXTRAÇÃO DOS CORPUS EXAMPLES a partir dos elementos com classe "assetlink" e "exaGroup"
  const corpusExamples: CorpusExampleGroup[] = [];
  $('span.assetlink span.exaGroup').each((i, groupElem) => {
    const groupTitle = $(groupElem).find('span.title').first().text().trim();
    const examples: string[] = [];
    // Procura por exemplos dentro de elementos com classes que comecem com "cexa"
    $(groupElem)
      .find('span[class^="cexa"]')
      .each((j, exElem) => {
        const exText = $(exElem).text().trim();
        if (exText) {
          examples.push(exText);
        }
      });
    if (groupTitle && examples.length > 0) {
      corpusExamples.push({
        group: groupTitle,
        examples,
      });
    }
  });

  // EXTRAÇÃO DA ORIGEM a partir do bloco "etym"
  const etymEl = $('span.etym');
  const origin: Origin = {
    word,
    originId: etymEl.find('.HOMNUM').first().text().trim() || 'rot1',
    language: etymEl.find('.LANG').first().text().trim() || 'Old English',
    form: etymEl.find('.ORIGIN').first().text().trim() || 'rotian',
  };

  const dictionaryEntry: DictionaryEntry = {
    word,
    introduction: introduction || "From Longman Dictionary of Contemporary English",
    relatedTopics,
    entries,
    corpusExamples,
    origin,
  };

  return dictionaryEntry;
}

/* MCP Server – integra a função fetchDictionaryEntry */
class LdoceMcpServer {
  private server: Server;

  constructor() {
    console.error('[Setup] Initializing MCP server for Longman Dictionary...');
    this.server = new Server(
      {
        name: 'ldoce-mcp-server',
        version: '0.1.0',
      },
      { capabilities: { tools: {} } }
    );

    this.setupToolHandlers().catch(console.error);
    this.server.onerror = (error) => console.error('[Error]', error);
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
          description: 'Busca e retorna a entrada do Longman Dictionary para uma palavra',
          inputSchema: {
            type: 'object',
            properties: {
              word: {
                type: 'string',
                description: 'Palavra para buscar (ex: rot)',
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
        console.error(`[API] Searching entry for word: ${args.word}`);
        const dictionaryEntry = await fetchDictionaryEntry(args.word);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(dictionaryEntry, null, 2),
            },
          ],
        };
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      } catch (error: any) {        
        console.error('[Error] Failed to fetch entry:', error.message);
        throw new McpError(ErrorCode.InternalError, `Falha ao buscar a entrada: ${error.message}`);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Ldoce MCP server running via stdio');
  }
}

const serverInstance = new LdoceMcpServer();
serverInstance.run().catch(console.error);
