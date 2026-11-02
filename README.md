# SQL-mcp

Server MCP (Model Context Protocol) per **SQL Server** e **PostgreSQL**, con esplorazione di schemi, oggetti e metadati, operazioni sui dati e gestione di database e tabelle. Può essere avviato con Node.js oppure distribuito come **eseguibile Windows autonomo**, senza installare Node.js sul computer di destinazione.

Il progetto supporta query di lettura, inserimento, aggiornamento e cancellazione dei dati, oltre a creazione, modifica ed eliminazione di database, tabelle e altri oggetti SQL. Il motore del database applica i permessi dell'utenza configurata.

## Indice

- [Funzionalità](#funzionalità)
- [Requisiti](#requisiti)
- [Installazione e avvio con Node.js](#installazione-e-avvio-con-nodejs)
- [Configurazione](#configurazione)
- [Eseguibile Windows autonomo](#eseguibile-windows-autonomo)
- [Collegamento ai client MCP](#collegamento-ai-client-mcp)
- [Avvio HTTP e Docker](#avvio-http-e-docker)
- [Esecuzione delle query e operazioni di scrittura](#esecuzione-delle-query-e-operazioni-di-scrittura)
- [Strumenti per SQL Server](#strumenti-per-sql-server)
- [Strumenti per PostgreSQL](#strumenti-per-postgresql)
- [Permessi del database](#permessi-del-database)
- [Controlli di accesso e riservatezza dei dati](#controlli-di-accesso-e-riservatezza-dei-dati)
- [Registrazione delle operazioni](#registrazione-delle-operazioni)
- [Test e verifica del funzionamento](#test-e-verifica-del-funzionamento)
- [Aggiunta di un provider](#aggiunta-di-un-provider)
- [Struttura del progetto e sviluppo](#struttura-del-progetto-e-sviluppo)
- [Risoluzione dei problemi](#risoluzione-dei-problemi)

## Funzionalità

| Area | Funzioni disponibili |
|---|---|
| Esplorazione | Database, schemi, tabelle, viste, colonne, indici, chiavi esterne e metadati specifici del motore |
| Lettura dei dati | Query `SELECT` e query con espressioni comuni di tabella, o CTE |
| Modifica dei dati | `INSERT`, `UPDATE`, `DELETE` e altri comandi supportati dal motore |
| Gestione degli oggetti | `CREATE`, `ALTER`, `DROP` e `TRUNCATE`, comprese operazioni su database e tabelle |
| Risultati SQL | Righe restituite, conteggi del driver, risultati multipli e limiti della risposta |
| Trasporti MCP | Comunicazione locale tramite stdio oppure MCP Streamable HTTP su `/mcp` |
| Distribuzione | Applicazione Node.js compilata, contenitore Docker o eseguibile Windows silente con runtime incorporato |
| Configurazione | Variabili d'ambiente e file `.env` esterno |
| Controlli applicativi | Modalità `read` e `write`, controlli su schemi e tabelle, mascheramento contestuale delle colonne |
| Audit | File JSON giornalieri e registrazione facoltativa su un database SQL Server |
| Estensione | Generatore di provider tramite `npm run scaffold` |

Le modifiche principali comprendono la compilazione in `.exe`, il caricamento di `.env` accanto all'eseguibile, l'abilitazione delle operazioni SQL di scrittura per entrambi i provider e una gestione condivisa dei risultati e dei controlli sulle query.

## Requisiti

### Sviluppo ed esecuzione con Node.js

- Node.js **22 o successivo** e npm.
- Accesso a un'istanza SQL Server, anche Azure SQL, oppure PostgreSQL; il progetto è destinato a PostgreSQL 13 o successivo.
- Un'utenza del database con i permessi necessari alle operazioni richieste.
- Windows per generare l'eseguibile `.exe` con lo script incluso.
- Docker, se si sceglie la distribuzione in contenitore.

### Esecuzione del file Windows

Sul computer di destinazione servono il file `.exe`, la configurazione del database e l'accesso di rete al server. Node.js, npm, i sorgenti e la cartella `node_modules` non devono essere installati o copiati: runtime e dipendenze necessarie sono incorporati nell'eseguibile.

L'architettura Windows deve essere compatibile con quella del runtime usato in compilazione. Per esempio, una compilazione con Node.js Windows x64 produce un eseguibile x64. L'autenticazione PostgreSQL tramite Microsoft Entra richiede anche Azure CLI e una sessione `az login` valida nell'ambiente di esecuzione.

## Installazione e avvio con Node.js

```powershell
git clone https://github.com/teghoz/sql-mcp.git
cd sql-mcp
npm install
Copy-Item .env.example .env
```

La copia di `.env.example` serve alla prima configurazione. Se esiste già un `.env`, modifica quello esistente per conservarne i valori.

Configura il database nel file `.env`, quindi compila e avvia:

```powershell
npm run build
npm start
```

La compilazione TypeScript genera i file JavaScript in `dist/`; l'avvio esegue `node dist/index.js`.

- Con `PORT=3000`, l'applicazione rimane in ascolto HTTP sulla porta 3000.
- Senza `PORT`, viene avviato il trasporto stdio, usato dai client MCP che lanciano il processo locale.

Per un primo avvio HTTP, aggiungi al `.env`:

```env
PORT=3000
SQL_ACCESS_LEVEL=write
```

Poi verifica da un altro terminale:

```powershell
Invoke-RestMethod http://localhost:3000/
```

Se è già disponibile un `package-lock.json` coerente con `package.json`, puoi installare le dipendenze con `npm ci` al posto di `npm install`.

## Configurazione

### Posizione del file e precedenza dei valori

| Modalità di esecuzione | File caricato automaticamente |
|---|---|
| Sorgenti TypeScript o JavaScript in `dist/` | `.env` nella cartella principale del progetto |
| Eseguibile Windows | `.env` nella stessa cartella del file `.exe` |
| Docker | Variabili passate al contenitore con Compose, `--env-file` o `-e` |

La posizione del `.env` per Node.js e per l'eseguibile non dipende dalla cartella da cui viene avviato il processo. Le variabili d'ambiente già presenti nel processo hanno precedenza sui valori del file. Dopo aver modificato la configurazione, riavvia il server e ricollega il client MCP per aggiornare le informazioni sugli strumenti.

### Scelta del provider

Imposta uno dei seguenti valori:

| Variabile | Valore | Motore |
|---|---|---|
| `DB_PROVIDER` | `mssql` | SQL Server; valore predefinito |
| `DB_PROVIDER` | `postgres` | PostgreSQL |

Ogni processo usa un provider. Per collegarti a motori o server differenti, avvia processi separati con le rispettive configurazioni.

### SQL Server

#### Stringa di connessione

```env
DB_PROVIDER=mssql
SQL_CONNECTION_STRING=Server=localhost,1433;Database=Applicazione;User Id=sql_mcp_user;Password=password_di_esempio;Encrypt=true;TrustServerCertificate=false;
```

Quando è presente `SQL_CONNECTION_STRING`, i parametri individuali di connessione vengono sostituiti dalla stringa. Le impostazioni condivise, come `SQL_ACCESS_LEVEL` e quelle per audit e riservatezza, continuano ad applicarsi.

| Chiave | Esempio | Significato |
|---|---|---|
| `Server` | `localhost,1433` | Indirizzo e porta, separati da una virgola |
| `Database` | `Applicazione` | Database iniziale della connessione |
| `User Id` | `sql_mcp_user` | Utente SQL Server |
| `Password` | `password_di_esempio` | Password dell'utente |
| `Encrypt` | `true` | Abilitazione della cifratura TLS |
| `TrustServerCertificate` | `false` | Controllo dell'attendibilità del certificato |
| `Connection Timeout` | `30` | Tempo massimo di connessione, in secondi |

Le stringhe provenienti da configurazioni .NET vengono normalizzate prima di essere passate al driver:

| Chiave .NET | Chiave normalizzata |
|---|---|
| `Data Source` | `Server` |
| `Initial Catalog` | `Database` |
| `User ID` | `User Id` |
| `Integrated Security` | `Trusted_Connection` |
| `Connect Timeout` | `Connection Timeout` |

Le chiavi `Persist Security Info`, `MultipleActiveResultSets` e `Application Name` vengono rimosse dalla stringa dal codice di normalizzazione.

#### Parametri individuali

```env
DB_PROVIDER=mssql
SQL_SERVER=localhost
SQL_PORT=1433
SQL_DATABASE=Applicazione
SQL_USER=sql_mcp_user
SQL_PASSWORD=password_di_esempio
SQL_ENCRYPT=false
SQL_TRUST_SERVER_CERTIFICATE=true
SQL_REQUEST_TIMEOUT=30000
```

| Variabile | Significato |
|---|---|
| `SQL_SERVER` | Indirizzo del server; obbligatorio senza stringa di connessione |
| `SQL_PORT` | Porta TCP; valore predefinito `1433` |
| `SQL_DATABASE` | Database iniziale; specificarlo per rendere esplicito il contesto |
| `SQL_USER` | Utente; obbligatorio senza stringa di connessione |
| `SQL_PASSWORD` | Password; obbligatoria senza stringa di connessione |
| `SQL_ENCRYPT` | La cifratura è attiva salvo valore `false` |
| `SQL_TRUST_SERVER_CERTIFICATE` | Il valore `true` accetta il certificato senza verificarne l'attendibilità; utile con certificati autofirmati di sviluppo |
| `SQL_REQUEST_TIMEOUT` | Tempo massimo della query in millisecondi; valore predefinito `30000` con i parametri individuali |

Gli esempi con cifratura disattivata e certificati autofirmati rappresentano una configurazione locale di sviluppo. Per una connessione con verifica del certificato usa `SQL_ENCRYPT=true` e `SQL_TRUST_SERVER_CERTIFICATE=false`.

### PostgreSQL

#### Stringa di connessione

```env
DB_PROVIDER=postgres
PG_CONNECTION_STRING=postgresql://sql_mcp_user:password_di_esempio@localhost:5432/applicazione
```

La stringa ha precedenza sui parametri individuali quando l'autenticazione Entra non è attiva.

#### Parametri individuali

```env
DB_PROVIDER=postgres
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=applicazione
PG_USER=sql_mcp_user
PG_PASSWORD=password_di_esempio
PG_SSL=false
PG_STATEMENT_TIMEOUT=30000
```

| Variabile | Significato |
|---|---|
| `PG_HOST` | Indirizzo del server; obbligatorio senza stringa di connessione |
| `PG_PORT` | Porta TCP; valore predefinito `5432` |
| `PG_DATABASE` | Database iniziale da usare per le query |
| `PG_USER` | Utente; obbligatorio senza stringa di connessione |
| `PG_PASSWORD` | Password; obbligatoria senza stringa di connessione e senza autenticazione Entra |
| `PG_SSL` | Il valore `true` abilita TLS con la configurazione attuale del provider |
| `PG_STATEMENT_TIMEOUT` | Tempo massimo dell'istruzione in millisecondi; valore predefinito `30000` con i parametri individuali |

Con i parametri individuali, la configurazione TLS attuale del provider imposta `rejectUnauthorized: false`: abilita la cifratura senza verificare l'attendibilità del certificato del server. Le opzioni contenute in `PG_CONNECTION_STRING` sono invece gestite dal driver.

#### Microsoft Entra, già Azure AD

Per Azure Database for PostgreSQL con autenticazione Entra:

```env
DB_PROVIDER=postgres
PG_AZURE_AD_AUTH=true
PG_HOST=mioserver.postgres.database.azure.com
PG_PORT=5432
PG_DATABASE=applicazione
PG_USER=principal_entra
```

In questa modalità il provider acquisisce il token tramite `AzureCliCredential` quando serve una connessione, usando l'ambito `https://ossrdbms-aad.database.windows.net/.default`. Non occorre salvare un token in `PG_PASSWORD`; le richieste successive usano il meccanismo di acquisizione e rinnovo delle credenziali Azure.

Sono necessari Azure CLI, una sessione `az login` valida e un'identità `PG_USER` associata a un ruolo PostgreSQL sul server. Usa i parametri individuali: con `PG_AZURE_AD_AUTH=true`, il provider non usa `PG_CONNECTION_STRING` e forza TLS.

### Livello di accesso SQL

```env
SQL_ACCESS_LEVEL=write
```

L'impostazione vale per entrambi i provider:

| Valore | Comportamento |
|---|---|
| `write` | Valore predefinito: permette letture, modifiche ai dati e comandi di gestione di database e oggetti |
| `read` | Attiva il validatore applicativo per query `SELECT` e `WITH ... SELECT` e il blocco delle parole chiave di scrittura |

Un valore diverso causa un errore di configurazione all'avvio. Il valore viene normalizzato rimuovendo gli spazi iniziali e finali e ignorando maiuscole e minuscole.

La modalità scelta viene riportata nei messaggi di avvio e nella descrizione dello strumento `execute_query`. Le annotazioni MCP `readOnlyHint` e `destructiveHint` riflettono il livello configurato.

`write` abilita l'inoltro dei comandi al motore; i privilegi restano quelli dell'utente database. Per un'effettiva utenza di sola lettura, associa `read` a permessi di sola lettura nel database.

### Trasporto HTTP o stdio

```env
PORT=3000
```

La presenza di una porta valida abilita HTTP. Se `PORT` non è impostata, viene usato stdio. Il file `.env.example` nella cartella principale lascia la porta commentata; l'esempio generato in `release/` abilita `PORT=3000` per l'avvio autonomo via HTTP.

## Eseguibile Windows autonomo

### Contenuto dell'eseguibile

Lo script di compilazione include applicazione, provider SQL Server e PostgreSQL, dipendenze JavaScript necessarie e runtime Node.js. La configurazione resta in un `.env` esterno, così può essere modificata senza ricompilare e le credenziali non vengono incorporate durante la compilazione.

La compilazione predefinita genera un'applicazione Windows **silente**, che non apre una finestra del terminale. Con HTTP abilitato, il processo continua a funzionare in background anche dopo la chiusura del programma che lo ha avviato. Gli strumenti MCP restano disponibili su `/mcp`.

La procedura usa [Node.js Single Executable Applications](https://nodejs.org/download/release/v24.0.0/docs/api/single-executable-applications.html), con esbuild per riunire il codice in un file CommonJS e postject per incorporarlo in una copia del runtime. Lo stesso eseguibile Node.js viene usato per generare il contenuto incorporato e fornire il runtime finale.

### Compilazione su Windows

Dalla cartella del progetto:

```powershell
npm install
npm run build:exe
```

Il comando esegue prima la compilazione TypeScript e poi il confezionamento dell'applicazione. Genera:

| Percorso | Contenuto |
|---|---|
| `dist/` | Applicazione compilata, dichiarazioni TypeScript e mappe dei sorgenti |
| `dist/sea/` | File JavaScript riunito, configurazione SEA e contenuto binario da incorporare |
| `release/sql-mcp.exe` | Eseguibile distribuibile |
| `release/.env.example` | Esempio di configurazione con HTTP abilitato |

Lo script richiede Windows e Node.js 22 o successivo. L'eseguibile incorpora la versione e l'architettura di Node.js usate per compilarlo. Ricompilalo dopo modifiche al codice o alle dipendenze; una modifica al solo `.env` richiede il riavvio.

### Configurazione e primo avvio

Solo alla prima configurazione:

```powershell
Copy-Item .\release\.env.example .\release\.env
notepad .\release\.env
```

Inserisci i parametri del database e scegli il livello di accesso. Poi avvia:

```powershell
Start-Process -FilePath .\release\sql-mcp.exe -WindowStyle Hidden
```

Puoi anche aprire direttamente `sql-mcp.exe` con un doppio clic. Per l'esecuzione autonoma in background configura `PORT=3000` nel `.env`; senza `PORT`, il processo usa stdio e deve essere avviato da un client MCP.

Con l'esempio generato, gli indirizzi sono:

- `http://localhost:3000/`: informazioni sul processo e sugli strumenti disponibili.
- `http://localhost:3000/mcp`: punto di accesso MCP Streamable HTTP.

Per visualizzare la guida dell'eseguibile:

```powershell
.\release\sql-mcp.exe --help
```

### Distribuzione su un altro computer

Copia il file `.exe` e il relativo `.env` nella stessa cartella:

```text
C:\Apps\sql-mcp\
  sql-mcp.exe
  .env
  logs\
```

La cartella `logs/` viene creata al primo evento di audit. Per impostazione predefinita si trova accanto all'eseguibile e deve essere scrivibile; puoi scegliere un altro percorso tramite `AUDIT_LOG_PATH`.

L'eseguibile rimane visibile nella sezione **Dettagli** di Gestione attività. Per arrestarlo puoi terminarne il processo da lì oppure usare PowerShell, indicando il nome della copia da chiudere:

```powershell
Get-Process -Name sql-mcp | Select-Object Id, ProcessName
Stop-Process -Id <ID_DEL_PROCESSO>
```

Sostituisci `<ID_DEL_PROCESSO>` con l'ID mostrato dal primo comando. Lo script non installa un servizio Windows, non configura l'avvio automatico e non aggiunge una firma digitale. Una firma può essere applicata all'eseguibile prodotto con gli strumenti previsti dalla distribuzione.

### Messaggi di avvio ed errori della versione silente

La versione silente salva i messaggi applicativi in `logs/server-YYYY-MM-DD.log` accanto al file `.exe`, con data e orario UTC. Il file include avvio HTTP, livello di accesso SQL ed errori, come porta non valida, porta già occupata o configurazione mancante. Il processo termina con codice `1` quando l'avvio fallisce.

Per scegliere un'altra cartella, configura un percorso assoluto:

```env
APP_LOG_PATH=C:/Apps/sql-mcp/logs
```

I file `server-*.log` contengono i messaggi applicativi; i file `audit-*.log` registrano le operazioni SQL. Le impostazioni `APP_LOG_PATH` e `AUDIT_LOG_PATH` sono indipendenti. I percorsi relativi personalizzati vengono risolti dalla cartella di lavoro del processo.

### Compilazione con console per la diagnosi

Per ottenere una variante che mantiene la console e i messaggi su stderr:

```powershell
npm run build:exe -- --console sql-mcp-console.exe
.\release\sql-mcp-console.exe
```

Questa variante usa lo stesso `.env` della cartella `release/` e si arresta con **Ctrl+C**. È utile anche per leggere direttamente la guida con `--help`. La versione silente resta utilizzabile tramite stdio da un client MCP: i flussi del protocollo vengono conservati e i messaggi diagnostici restano disponibili su stderr per il client.

### Aggiornamento di una copia già in esecuzione

Se il file da aggiornare è in uso, genera un eseguibile con un altro nome:

```powershell
npm run build:exe -- sql-mcp-next.exe
```

Il risultato è `release/sql-mcp-next.exe`, che usa il `.env` presente nella stessa cartella. Arresta la vecchia istanza prima di avviare la nuova sulla stessa porta:

```powershell
.\release\sql-mcp-next.exe
```

Il nome alternativo non viene scelto automaticamente dai test: indica esplicitamente il percorso, come descritto nella sezione [Test e verifica del funzionamento](#test-e-verifica-del-funzionamento).

## Collegamento ai client MCP

### Avvio locale dell'eseguibile con stdio

Per un client che deve avviare il processo, rimuovi o commenta `PORT` nel `.env` accanto all'eseguibile. Configurazione MCP:

```json
{
  "mcpServers": {
    "sql-mcp": {
      "command": "C:/Apps/sql-mcp/sql-mcp.exe"
    }
  }
}
```

Le credenziali possono restare nel `.env`. La configurazione del client può anche passare variabili tramite `env`; queste hanno precedenza sui valori del file.

### Avvio locale tramite Node.js

Dopo `npm run build`:

```json
{
  "mcpServers": {
    "sql-mcp": {
      "command": "node",
      "args": ["C:/Projects/sql-mcp/dist/index.js"],
      "env": {
        "DB_PROVIDER": "mssql",
        "SQL_ACCESS_LEVEL": "write",
        "SQL_CONNECTION_STRING": "Server=localhost,1433;Database=Applicazione;User Id=sql_mcp_user;Password=password_di_esempio;Encrypt=false;TrustServerCertificate=true;"
      }
    }
  }
}
```

In alternativa, salva questi valori nel `.env` della cartella principale del progetto e ometti il blocco `env`. Anche qui `PORT` deve essere assente per stdio.

### Collegamento HTTP

Avvia il server con `PORT=3000`, quindi configura il client:

```json
{
  "mcpServers": {
    "sql-mcp": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Claude Code

In Claude Code, le configurazioni condivise con il progetto si trovano in `.mcp.json`; quelle con ambito utente vengono gestite in `~/.claude.json`. Puoi registrare il server dalla CLI:

```powershell
# Eseguibile locale con configurazione stdio
claude mcp add sql-mcp --scope user -- "C:/Apps/sql-mcp/sql-mcp.exe"

# In alternativa, applicazione avviata con Node.js
claude mcp add sql-mcp --scope user -- node "C:/Projects/sql-mcp/dist/index.js"

# In alternativa, server HTTP già avviato
claude mcp add --transport http sql-mcp --scope user http://localhost:3000/mcp
```

Scegli uno dei tre esempi. Usa `--scope project` per una registrazione condivisa nel progetto. Per i dettagli dei formati e degli ambiti consulta la [documentazione MCP di Claude Code](https://code.claude.com/docs/en/mcp).

### Più database o server

Gli strumenti che espongono `database` possono usare database diversi sulla stessa istanza. Il processo mantiene un gruppo di connessioni, o pool, per ciascun database richiesto. Per esempio, `list_tables` con `database: "Reporting"` esplora quel database senza avviare un altro processo.

Per istanze o motori differenti, registra processi separati con nomi distinti, per esempio `sql-mcp-sviluppo` e `sql-mcp-reporting`, e passa a ognuno le rispettive variabili di connessione. Gli strumenti a livello di istanza e quelli senza parametro `database` usano il contesto previsto dal relativo provider.

## Avvio HTTP e Docker

Il server espone le stesse funzioni SQL anche tramite HTTP. Ogni richiesta a `/mcp` usa un'istanza MCP senza sessione persistente del protocollo; i pool delle connessioni database appartengono al processo e vengono riutilizzati.

### Verifica del processo HTTP

```powershell
Invoke-RestMethod http://localhost:3000/
```

Esempio con il provider SQL Server:

```json
{
  "name": "mssql",
  "version": "1.0.0",
  "tools": 37
}
```

Il campo `name` identifica il provider: `mssql` oppure `postgres`. Il numero di strumenti dipende dal provider. Questo punto di accesso conferma che il processo risponde; la connessione al database viene verificata eseguendo una query.

### Docker Compose

Dopo aver compilato la configurazione nel `.env` principale:

```powershell
npm install
docker compose up --build
```

Il Dockerfile usa `npm ci`, quindi `package-lock.json` deve essere disponibile nel contesto di compilazione. `npm install` lo genera se manca.

Il file `docker-compose.yml` incluso pubblica la porta 3000 e passa i parametri individuali SQL Server e `SQL_ACCESS_LEVEL`, con valore predefinito `write`. La lettura del `.env` da parte di Compose serve alla sostituzione delle variabili dichiarate nel file: non inoltra automaticamente ogni variabile al contenitore.

### Docker con un file di configurazione completo

Per passare anche `DB_PROVIDER`, stringhe di connessione, parametri PostgreSQL e impostazioni di audit, puoi usare:

```powershell
docker build -t sql-mcp .
docker run --rm --env-file .env -e PORT=3000 -p 3000:3000 sql-mcp
```

Il punto di accesso MCP è `http://localhost:3000/mcp`. Un percorso `AUDIT_LOG_PATH` nel contenitore si riferisce al suo filesystem; per conservare i file dopo la rimozione del contenitore, associa quella cartella a un volume.

## Esecuzione delle query e operazioni di scrittura

### Strumento `execute_query`

Lo strumento è condiviso da SQL Server e PostgreSQL. In modalità `write` inoltra al motore il comando SQL richiesto, comprese operazioni sui dati e sulla struttura del database.

| Parametro | Obbligatorio | Descrizione |
|---|---|---|
| `query` | Sì | Istruzione o batch SQL non vuoto, nella sintassi del motore selezionato |
| `database` | No | Database sul quale aprire la connessione; in assenza viene usato quello configurato |
| `max_rows` | No | Intero positivo che limita le righe restituite; valore predefinito `1000`, con limite massimo determinato da `SQL_MAX_ROWS` |

Il supporto alla scrittura include `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP` e `TRUNCATE`. Altri comandi vengono gestiti dal motore secondo sintassi e privilegi disponibili. Non è richiesto un nuovo strumento MCP per ciascuna operazione.

### Formato della risposta

Il contenuto testuale della risposta MCP contiene un oggetto JSON. Per una lettura:

```json
{
  "rows": [{ "id": 42, "prezzo": 19.9 }],
  "row_count": 1,
  "truncated": false,
  "affected_rows": 1,
  "rows_affected": [1]
}
```

| Campo | Significato |
|---|---|
| `rows` | Righe del primo insieme di risultati, dopo l'applicazione del limite della risposta |
| `row_count` | Numero di righe presenti in `rows` |
| `truncated` | Indica se almeno un insieme di risultati è stato ridotto dal limite |
| `affected_rows` | Somma dei conteggi comunicati dal driver |
| `rows_affected` | Conteggi individuali comunicati dal driver, nel relativo ordine |
| `result_sets` | Presente se il comando restituisce più insiemi di risultati; ciascuno contiene `rows`, `row_count` e `truncated` |

I driver possono includere nei conteggi anche le righe elaborate da `SELECT`: `affected_rows` non rappresenta necessariamente il solo numero di righe modificate. Per DDL senza risultati il conteggio è generalmente zero.

Un aggiornamento senza `OUTPUT` o `RETURNING`, per esempio, può restituire:

```json
{
  "rows": [],
  "row_count": 0,
  "truncated": false,
  "affected_rows": 3,
  "rows_affected": [3]
}
```

Gli errori del motore vengono restituiti come risposte MCP con `isError: true` e testo diagnostico, anche per problemi di sintassi o permessi.

### Limiti delle righe e risultati multipli

Il limite effettivo è il minore tra `max_rows`, che vale `1000` se omesso, e `SQL_MAX_ROWS`, il cui valore predefinito è `5000`.

Il budget di righe è condiviso tra tutti gli insiemi di risultati del comando. Il campo `rows` mantiene il primo risultato per compatibilità; gli eventuali altri risultati sono presenti in `result_sets`.

Questo limite riguarda la risposta MCP. Per scegliere quante righe aggiornare o eliminare usa condizioni e istruzioni SQL appropriate. Per ridurre anche il lavoro del database nelle letture usa `TOP` o `FETCH NEXT` su SQL Server e `LIMIT` su PostgreSQL.

### Esempi sui dati e sulle tabelle

Gli esempi seguenti mostrano gli argomenti da passare a `execute_query`, non una sequenza eseguita automaticamente.

Creazione di una tabella su SQL Server:

```json
{
  "query": "CREATE TABLE dbo.prodotti (id int PRIMARY KEY, nome nvarchar(100), prezzo decimal(10,2))",
  "database": "Negozio"
}
```

Inserimento, aggiornamento e cancellazione di dati:

```json
{
  "query": "INSERT INTO dbo.prodotti (id, nome, prezzo) VALUES (42, 'Prodotto di esempio', 10.00)",
  "database": "Negozio"
}
```

```json
{
  "query": "UPDATE dbo.prodotti SET prezzo = 19.90 WHERE id = 42",
  "database": "Negozio"
}
```

```json
{
  "query": "DELETE FROM dbo.prodotti WHERE id = 42",
  "database": "Negozio"
}
```

Modifica della struttura ed eliminazione della tabella:

```json
{
  "query": "ALTER TABLE dbo.prodotti ADD attivo bit NULL",
  "database": "Negozio"
}
```

```json
{
  "query": "DROP TABLE dbo.prodotti",
  "database": "Negozio"
}
```

Su PostgreSQL usa la sintassi del motore e lo schema desiderato, per esempio:

```json
{
  "query": "UPDATE public.prodotti SET prezzo = 19.90 WHERE id = 42 RETURNING id, prezzo",
  "database": "negozio"
}
```

`RETURNING` in PostgreSQL e `OUTPUT` in SQL Server permettono di ottenere i dati delle righe coinvolte nell'operazione, oltre ai conteggi.

### Creazione, modifica ed eliminazione dei database

Per amministrare database SQL Server, apri la connessione su `master`:

```json
{ "query": "CREATE DATABASE DemoDb", "database": "master" }
```

```json
{ "query": "ALTER DATABASE DemoDb MODIFY NAME = DemoDbNuovo", "database": "master" }
```

```json
{ "query": "DROP DATABASE DemoDbNuovo", "database": "master" }
```

Per PostgreSQL puoi usare una connessione a `postgres`:

```json
{ "query": "CREATE DATABASE demo_db", "database": "postgres" }
```

```json
{ "query": "ALTER DATABASE demo_db RENAME TO demo_db_nuovo", "database": "postgres" }
```

```json
{ "query": "DROP DATABASE demo_db_nuovo", "database": "postgres" }
```

Le regole del motore continuano ad applicarsi: per esempio, PostgreSQL richiede `CREATE DATABASE` e `DROP DATABASE` come comandi individuali fuori da una transazione. Per eliminare un database devi collegarti a un altro database e gestire le eventuali connessioni attive, comprese quelle conservate nei pool del processo.

L'applicazione non racchiude automaticamente i comandi in transazioni e non termina automaticamente le altre sessioni. Per le operazioni che richiedono una transazione invia un batch completo sullo stesso collegamento: chiamate MCP separate non garantiscono l'uso della stessa connessione fisica.

Riferimenti: [CREATE DATABASE in PostgreSQL](https://www.postgresql.org/docs/current/sql-createdatabase.html), [DROP DATABASE in PostgreSQL](https://www.postgresql.org/docs/current/sql-dropdatabase.html), [DROP DATABASE in SQL Server](https://learn.microsoft.com/en-us/sql/t-sql/statements/drop-database-transact-sql).

## Strumenti per SQL Server

Il provider `mssql` espone attualmente **37 strumenti**, incluso `execute_query`. Le definizioni MCP indicano per ciascuno i parametri ammessi; i nomi dei parametri restano in inglese perché fanno parte dell'interfaccia.

Nelle tabelle, «Nessuno» indica che non sono richiesti parametri. Quando è disponibile e viene omesso, `database` usa il database configurato. `schema` è il nome dello schema, per esempio `dbo`; `table`, `view` e `name` identificano l'oggetto richiesto.

### Database, tabelle e viste

| Strumento | Parametri obbligatori | Parametri facoltativi | Descrizione |
|---|---|---|---|
| `list_databases` | Nessuno | Nessuno | Elenca i database online dell'istanza |
| `list_schemas` | Nessuno | `database` | Elenca gli schemi e i relativi proprietari |
| `list_tables` | Nessuno | `database`, `schema` | Elenca le tabelle, con filtro facoltativo per schema |
| `describe_table` | `schema`, `table` | `database` | Restituisce colonne, tipi, lunghezze, nullabilità, valori predefiniti e ordine |
| `get_table_indexes` | `schema`, `table` | `database` | Elenca indici, tipo, unicità, chiave primaria e colonne chiave |
| `get_foreign_keys` | `schema`, `table` | `database` | Restituisce chiavi esterne, colonne collegate e azioni di aggiornamento o cancellazione |
| `list_views` | Nessuno | `database`, `schema` | Elenca le viste |
| `describe_view` | `schema`, `view` | `database` | Restituisce colonne e definizione SQL della vista |
| `list_synonyms` | Nessuno | `database`, `schema` | Elenca i sinonimi e i relativi oggetti di destinazione |
| `get_synonym_definition` | `schema`, `name` | `database` | Restituisce l'oggetto di destinazione del sinonimo e le date di creazione e modifica |

### Programmabilità e definizioni

| Strumento | Parametri obbligatori | Parametri facoltativi | Descrizione |
|---|---|---|---|
| `list_stored_procedures` | Nessuno | `database`, `schema` | Elenca le procedure memorizzate e le date di creazione e modifica |
| `get_stored_procedure_definition` | `schema`, `name` | `database` | Restituisce la definizione completa da `sys.sql_modules`, evitando il limite di 4000 caratteri di `INFORMATION_SCHEMA` |
| `list_functions` | Nessuno | `database`, `schema` | Elenca le funzioni definite dall'utente, comprese quelle scalari, tabellari e CLR |
| `get_function_definition` | `schema`, `name` | `database` | Restituisce il codice della funzione |
| `list_triggers` | Nessuno | `database`, `schema`, `table` | Elenca trigger DML, tabella di appartenenza, eventi, stato e indicazione `INSTEAD OF` |
| `get_trigger_definition` | `schema`, `name` | `database` | Restituisce la definizione del trigger DML; `schema` identifica lo schema della tabella |
| `get_table_constraints` | `schema`, `table` | `database` | Restituisce vincoli `PRIMARY KEY`, `UNIQUE`, `CHECK` e `DEFAULT` |
| `get_extended_properties` | `schema`, `name` | `database` | Legge proprietà estese dell'oggetto e delle colonne, come `MS_Description` |
| `list_sequences` | Nessuno | `database`, `schema` | Elenca sequenze, tipo, intervallo, incremento, ciclicità e valore corrente |

Le proprietà estese includono i campi `property_name`, `property_value`, `scope`, che distingue oggetto e colonna, e `column_name`.

### Statistiche e autorizzazioni

| Strumento | Parametri obbligatori | Parametri facoltativi | Descrizione |
|---|---|---|---|
| `get_table_stats` | `schema`, `table` | `database` | Restituisce numero di righe e spazio totale, usato e inutilizzato in MB |
| `list_database_users` | Nessuno | `database` | Elenca utenti, tipo, schema predefinito e accesso associato |
| `list_database_roles` | Nessuno | `database` | Elenca ruoli e membri, compresi ruoli fissi e ruoli senza membri |
| `get_object_permissions` | `schema`, `name` | `database` | Restituisce i permessi espliciti sull'oggetto |

### Istanza e SQL Server Agent

| Strumento | Parametri obbligatori | Parametri facoltativi | Descrizione |
|---|---|---|---|
| `get_server_properties` | Nessuno | Nessuno | Restituisce versione, edizione, regole di confronto, stato del cluster e alta disponibilità |
| `list_linked_servers` | Nessuno | Nessuno | Elenca i server collegati all'istanza |
| `list_agent_jobs` | Nessuno | Nessuno | Elenca attività SQL Server Agent, stato, categoria, proprietario e ultimo esito |
| `get_job_history` | `job_name` | `top` | Restituisce la cronologia dell'attività; `top` vale `50` se omesso ed è limitato a `500` |

`job_name` deve essere il nome esatto dell'attività. Per i permessi richiesti consulta [Permessi del database](#permessi-del-database).

### Funzioni avanzate

| Strumento | Parametri obbligatori | Parametri facoltativi | Descrizione |
|---|---|---|---|
| `list_partition_functions` | Nessuno | Nessuno | Elenca funzioni di partizionamento, intervalli `LEFT` o `RIGHT`, numero di partizioni e valori di confine nel database configurato |
| `list_partition_schemes` | Nessuno | Nessuno | Elenca schemi di partizionamento, funzioni associate e gruppi di file nel database configurato |
| `list_fulltext_catalogs` | Nessuno | `database` | Elenca cataloghi di ricerca testuale, numero di elementi, dimensione e stato di popolamento |
| `list_fulltext_indexes` | Nessuno | `database`, `schema` | Elenca indici di ricerca testuale, catalogo, colonne e stato del rilevamento modifiche |
| `list_service_queues` | Nessuno | `database`, `schema` | Elenca code Service Broker, stati di invio, ricezione e attivazione, e procedura di attivazione |
| `list_broker_services` | Nessuno | `database` | Elenca servizi Service Broker e code associate |
| `list_user_types` | Nessuno | `database`, `schema` | Elenca tipi scalari e tipi tabellari definiti dall'utente e relativo tipo di base |
| `get_table_type_columns` | `schema`, `name` | `database` | Restituisce le colonne di un tipo tabellare definito dall'utente |
| `list_temporal_tables` | Nessuno | `database`, `schema` | Elenca tabelle temporali con versionamento di sistema e tabelle della cronologia |
| `execute_query` | `query` | `database`, `max_rows` | Esegue SQL di lettura, modifica e amministrazione secondo `SQL_ACCESS_LEVEL` |

## Strumenti per PostgreSQL

Il provider `postgres` espone attualmente **16 strumenti**. L'esplorazione usa `information_schema` e `pg_catalog`.

| Strumento | Parametri obbligatori | Parametri facoltativi | Descrizione |
|---|---|---|---|
| `list_databases` | Nessuno | Nessuno | Elenca database non modello con dimensioni e codifica |
| `list_schemas` | Nessuno | `database` | Elenca schemi utente, escludendo quelli di sistema |
| `list_tables` | Nessuno | `database`, `schema` | Elenca tabelle con filtro per schema e dimensione totale |
| `describe_table` | `schema`, `table` | `database` | Restituisce colonne, tipi, nullabilità, valori predefiniti e commenti |
| `get_table_indexes` | `schema`, `table` | `database` | Elenca indici, tipo, unicità e definizione SQL |
| `get_foreign_keys` | `schema`, `table` | `database` | Restituisce chiavi esterne e regole di aggiornamento e cancellazione |
| `list_views` | Nessuno | `database`, `schema` | Elenca viste e informazioni sulla loro aggiornabilità |
| `describe_view` | `schema`, `name` | `database` | Restituisce colonne e definizione SQL della vista; il nome si passa con `name` |
| `list_functions` | Nessuno | `database`, `schema` | Elenca funzioni e procedure utente con firme, tipo di risultato e linguaggio |
| `get_function_definition` | `schema`, `name` | `database` | Restituisce la definizione tramite `pg_get_functiondef()` |
| `list_triggers` | Nessuno | `database`, `schema`, `table` | Elenca trigger con filtro facoltativo per schema o tabella |
| `get_trigger_definition` | `schema`, `name` | `database` | Restituisce la definizione tramite `pg_get_triggerdef()` |
| `list_sequences` | Nessuno | `database`, `schema` | Elenca sequenze, intervalli, incremento e ultimo valore |
| `get_table_stats` | `schema`, `table` | `database` | Restituisce righe stimate, tuple vive o eliminate, dimensioni e informazioni sulle operazioni di manutenzione |
| `get_server_properties` | Nessuno | Nessuno | Restituisce versione, utente e database correnti, impostazioni di memoria e dimensione complessiva |
| `execute_query` | `query` | `database`, `max_rows` | Esegue SQL di lettura, modifica e amministrazione secondo `SQL_ACCESS_LEVEL` |

## Permessi del database

Il server usa le credenziali configurate e non assegna privilegi aggiuntivi. Un'utenza che può soltanto leggere continuerà a ricevere errori dal database sui comandi di modifica, anche con `SQL_ACCESS_LEVEL=write`.

Per SQL Server, `db_datareader` copre molte operazioni di lettura delle tabelle; le modifiche ai dati richiedono i rispettivi permessi e le operazioni DDL richiedono privilegi sugli oggetti, sugli schemi o sull'istanza interessati. Creare o eliminare un database richiede autorizzazioni diverse dal semplice accesso alle tabelle.

Per PostgreSQL occorrono i privilegi sugli oggetti richiesti; creazione e gestione dei database seguono anche le regole di proprietà e i privilegi del ruolo. Il parametro `database` sceglie la connessione e non cambia i privilegi dell'utente.

### Permessi specifici degli strumenti SQL Server

| Strumento | Permesso o ruolo |
|---|---|
| `list_agent_jobs`, `get_job_history` | `SQLAgentUserRole` o ruolo superiore in `msdb` |
| `list_linked_servers` | Visibilità dei metadati dei server collegati, secondo i permessi dell'istanza |
| Definizioni di procedure, funzioni e trigger | `VIEW DEFINITION` sull'oggetto o permessi equivalenti |

Esempio per un accesso già esistente che deve leggere le attività SQL Server Agent; crea l'utente in `msdb` se non è già presente:

```sql
USE msdb;
CREATE USER sql_mcp_user FOR LOGIN sql_mcp_user;
ALTER ROLE SQLAgentUserRole ADD MEMBER sql_mcp_user;
```

Per concedere la lettura delle definizioni a livello di istanza, se appropriato ai permessi richiesti:

```sql
GRANT VIEW ANY DEFINITION TO sql_mcp_user;
```

### Esempio di configurazione di sola lettura

Imposta `SQL_ACCESS_LEVEL=read` e usa un'utenza SQL Server con soli privilegi di lettura:

```sql
CREATE LOGIN sql_mcp_reader WITH PASSWORD = 'password_di_esempio_da_sostituire';

USE [Applicazione];
CREATE USER sql_mcp_reader FOR LOGIN sql_mcp_reader;
ALTER ROLE db_datareader ADD MEMBER sql_mcp_reader;

-- Facoltativo: lettura delle definizioni di oggetti e moduli SQL.
GRANT VIEW DEFINITION TO sql_mcp_reader;
```

Il validatore di `read` usa controlli sulle istruzioni e sulle parole chiave; i permessi del database costituiscono il controllo effettivo sulle operazioni consentite.

## Controlli di accesso e riservatezza dei dati

Le impostazioni seguenti vengono usate dal nucleo condiviso dei provider:

| Variabile | Comportamento |
|---|---|
| `SQL_ALLOWED_SCHEMAS` | Elenco di schemi consentiti, separati da virgole; controllato quando la richiesta specifica `schema` |
| `SQL_BLOCKED_TABLES` | Elenco `schema.tabella` delle tabelle da bloccare tramite i controlli applicativi |
| `SQL_MASKED_COLUMNS` | Elenco `schema.tabella.colonna` da sostituire con `[MASKED]` quando il contesto della richiesta identifica schema e tabella |
| `SQL_MAX_ROWS` | Limite delle righe restituite da `execute_query`; valore predefinito `5000` |

```env
SQL_ALLOWED_SCHEMAS=dbo,reporting
SQL_BLOCKED_TABLES=dbo.segreti,hr.stipendi
SQL_MASKED_COLUMNS=dbo.utenti.codice_fiscale,dbo.utenti.carta_credito
SQL_MAX_ROWS=1000
```

Il controllo sugli argomenti viene eseguito prima del gestore dello strumento. Le liste di oggetti previste dal codice vengono filtrate in base ai riferimenti a schema e tabella. `execute_query` controlla inoltre il testo SQL alla ricerca dei riferimenti alle tabelle bloccate.

Questi controlli dipendono dagli argomenti disponibili e da confronti sul testo: non sono un'analisi completa del linguaggio SQL. In particolare, il mascheramento usa `schema` e `table` nel contesto e non ricostruisce automaticamente tabelle, alias o colonne di una query arbitraria. Quando il contesto è disponibile, il mascheramento viene applicato a tutti gli insiemi di risultati, compresi quelli restituiti dalle operazioni di modifica.

Le regole si applicano anche in modalità `write`. Per definire quali oggetti siano realmente accessibili usa anche i permessi del motore database. Il limite `SQL_MAX_ROWS` riguarda la risposta di `execute_query`, non il numero di righe modificate e non tutti gli elenchi di metadati.

## Registrazione delle operazioni

L'audit registra esecuzioni SQL, conteggi, errori del driver e richieste respinte dai controlli previsti. Il codice conserva l'hash SHA-256 della query invece di salvarne il testo nel campo `query_hash`.

### File JSON giornalieri

Ogni evento viene scritto su una riga del file `audit-YYYY-MM-DD.log`, usando la data UTC.

| Modalità | Percorso predefinito |
|---|---|
| Applicazione Node.js | `logs/` relativo alla cartella di lavoro del processo |
| Eseguibile Windows | `logs/` accanto all'eseguibile |
| Percorso personalizzato | Valore di `AUDIT_LOG_PATH`; un percorso relativo viene risolto dalla cartella di lavoro |

Esempio di registrazione di una modifica:

```json
{
  "ts": "2026-11-02T09:00:00.000Z",
  "tool": "execute_query",
  "database_name": "Applicazione",
  "schema_name": null,
  "object_name": null,
  "query_hash": "e3b0c44298fc1c149afb...",
  "row_count": 0,
  "affected_rows": 3,
  "masked_cols": null,
  "blocked": false,
  "block_reason": null,
  "duration_ms": 42
}
```

`row_count` nell'audit conta le righe restituite dal driver dopo i filtri applicativi e prima del limite della risposta MCP. `affected_rows` conserva la somma dei conteggi del driver. Quando l'esecuzione fallisce, il file può includere `error`; per i blocchi sono presenti `blocked` e `block_reason`.

I rifiuti nel gestore SQL conservano anche l'hash della query. Un blocco eseguito prima del gestore sulla base degli argomenti può avere `query_hash: null`.

### Registrazione su SQL Server

La destinazione SQL dell'audit usa il driver SQL Server anche se il provider principale è PostgreSQL. Configura:

```env
AUDIT_CONNECTION_STRING=Server=localhost,1433;Database=AuditDb;User Id=sql_mcp_audit_writer;Password=password_di_esempio;Encrypt=true;TrustServerCertificate=false;
```

In alternativa, `AUDIT_DATABASE=AuditDb` riusa i parametri individuali `SQL_SERVER`, `SQL_PORT`, `SQL_USER`, `SQL_PASSWORD` e quelli TLS, scegliendo il database di audit. Questa alternativa non riusa automaticamente `SQL_CONNECTION_STRING` né i parametri `PG_*`.

Prima di attivare la destinazione SQL, crea schema e tabella:

```sql
CREATE SCHEMA audit;

CREATE TABLE audit.mcp_audit_log (
  id            BIGINT IDENTITY(1,1) PRIMARY KEY,
  logged_at     DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  tool          NVARCHAR(100) NOT NULL,
  database_name NVARCHAR(128) NULL,
  schema_name   NVARCHAR(128) NULL,
  object_name   NVARCHAR(128) NULL,
  query_hash    CHAR(64) NULL,
  row_count     INT NULL,
  masked_cols   NVARCHAR(MAX) NULL,
  blocked       BIT NOT NULL DEFAULT 0,
  block_reason  NVARCHAR(500) NULL,
  duration_ms   INT NULL
);

GRANT INSERT ON audit.mcp_audit_log TO sql_mcp_audit_writer;
```

I campi aggiuntivi `affected_rows` ed `error` sono salvati nei file JSON; la destinazione SQL mantiene le colonne mostrate sopra. L'aggiunta di questi campi nei file non richiede una migrazione della tabella di audit esistente.

Le scritture di audit sono asincrone. Errori di accesso ai file o di collegamento alla destinazione SQL vengono riportati su stderr e non impediscono al gestore di restituire il risultato dell'operazione.

## Test e verifica del funzionamento

I test automatici dell'applicazione sono distinti dalle verifiche che si collegano al database configurato:

| Comando | Cosa verifica | Database reale |
|---|---|---|
| `npm test` | Compilazione e gestione condivisa delle query, usando i provider con operazioni del driver simulate | Non necessario |
| `npm run test:exe` | Funzionamento dell'eseguibile isolato, entrambi i provider, modalità di accesso, audit e HTTP | Non necessario |
| `npm run test:connection` | Avvio dell'eseguibile, collegamento MCP, elenco strumenti e `SELECT 1 AS ok` | Necessario |
| `npm run test:write` | Verifica della connessione e delle modifiche a una tabella temporanea della sessione | Necessario |

I comandi di test vengono eseguiti dalla cartella del progetto con Node.js e le dipendenze di sviluppo installate. L'eseguibile distribuito continua a funzionare autonomamente.

### Test della gestione delle query

```powershell
npm test
```

La suite attuale contiene 17 test. Verifica modalità predefinita e annotazioni MCP, inoltro di comandi sui dati e sugli oggetti, conteggi senza righe restituite, `OUTPUT` e `RETURNING`, risultati multipli, limite condiviso delle righe, modalità `read`, argomenti non validi, controlli sulle tabelle, mascheramento e audit degli errori.

Le chiamate di rete dei driver sono simulate: i test di `CREATE DATABASE` e `DROP DATABASE` verificano l'inoltro e la gestione dei risultati senza creare o cancellare database reali.

### Test dell'eseguibile isolato

Dopo averlo compilato:

```powershell
npm run test:exe
```

La suite attuale contiene 11 test ed è destinata alla compilazione silente predefinita. Copia il solo eseguibile in cartelle temporanee, crea configurazioni di prova e rimuove Node.js dal `PATH` del processo figlio. Verifica il sottosistema Windows senza console, guida, errori di configurazione, inizializzazione MCP tramite stdio, strumenti dei due provider, validazione in lettura, inoltro delle scritture, audit e risposta HTTP.

Verifica anche che il server resti attivo dopo l'uscita del processo che lo ha avviato, con i flussi standard scollegati, e che scriva i messaggi applicativi su file. I test coprono inoltre gli errori di porta non valida e porta già occupata.

Le connessioni dei driver vengono provate su porte locali non in ascolto: il risultato atteso è un errore di rete del driver. Questi test non usano le credenziali del database configurato dall'utente.

Per un eseguibile con nome o percorso diverso:

```powershell
$env:SQL_MCP_EXE = ".\release\sql-mcp-next.exe"
npm run test:exe
Remove-Item Env:\SQL_MCP_EXE
```

`SQL_MCP_EXE` viene letto dalla suite di isolamento, non dall'applicazione.

### Verifica della connessione configurata

```powershell
npm run test:connection
```

Il comando usa, salvo percorso esplicito, `release/sql-mcp.exe` e il `.env` che si trova accanto a quel file. Avvia temporaneamente il processo con stdio, inizializza MCP, elenca gli strumenti ed esegue `SELECT 1 AS ok`. Il cambio di trasporto vale per il processo di test e non modifica il file di configurazione.

Esempio di messaggi effettivi, mantenuti nella lingua emessa dallo script:

```text
OK: MCP connected.
OK: 37 tools available.
OK: SELECT 1 AS ok returned 1. Database connection verified.
```

Il numero di strumenti dipende dal provider. In caso di errore, il comando termina con codice di uscita `1` e un messaggio diagnostico. I valori configurati come password o stringhe di connessione vengono oscurati dai messaggi dello script quando corrispondono ai valori rilevati.

Per verificare una copia alternativa:

```powershell
npm run test:connection -- .\release\sql-mcp-next.exe
```

### Verifica reale delle operazioni di scrittura

Con `SQL_ACCESS_LEVEL=write`:

```powershell
npm run test:write
```

La prova esegue, nell'ordine:

1. Il test di connessione con `SELECT 1 AS ok`.
2. La creazione di una tabella temporanea.
3. L'inserimento di due righe.
4. L'aggiornamento di una riga.
5. L'aggiunta di una colonna con `ALTER TABLE`.
6. La cancellazione della seconda riga.
7. La lettura e verifica della riga rimasta e dei conteggi.
8. L'eliminazione della tabella temporanea.

Su SQL Server usa una tabella locale con prefisso `#`; su PostgreSQL usa `CREATE TEMP TABLE` e racchiude la sequenza in una transazione. La prova riguarda soltanto questa tabella di sessione e non crea né elimina database persistenti. La normale registrazione di audit continua ad applicarsi.

Il messaggio finale atteso è:

```text
OK: temporary table CREATE/ALTER/DROP and INSERT/UPDATE/DELETE verified.
```

Per il file prodotto con un nome alternativo:

```powershell
npm run test:write -- .\release\sql-mcp-next.exe
```

### Controllo HTTP manuale

Con `PORT=3000` nel `.env` dell'eseguibile, avvia il processo in background:

```powershell
Start-Process -FilePath .\release\sql-mcp.exe -WindowStyle Hidden
```

Poi, nello stesso terminale o in un altro:

```powershell
Invoke-RestMethod http://localhost:3000/
```

Il controllo della radice verifica il processo HTTP. Usa il test di connessione per verificare anche l'accesso al database, oppure un client MCP collegato a `/mcp` per invocare gli strumenti.

## Aggiunta di un provider

La logica comune permette di aggiungere un altro motore mantenendo trasporti, modalità di accesso, formattazione dei risultati e audit condivisi.

### 1. Generare i file iniziali

```powershell
npm run scaffold -- mysql
```

Vengono creati sei file:

```text
src/providers/mysql/
  client.ts
  index.ts
  tools/
    query.ts
    databases.ts
    schemas.ts
    tables.ts
```

Il nome deve contenere lettere minuscole, cifre o trattini e iniziare con una lettera. Il generatore rifiuta una cartella provider già esistente.

### 2. Installare il driver

Installa il driver del motore scelto, per esempio:

```powershell
npm install mysql2
```

Aggiungi eventuali definizioni TypeScript se non sono incluse nel pacchetto del driver.

### 3. Implementare connessioni ed esecuzione SQL

In `client.ts`, implementa `executeSql()` e `closePools()`. Normalizza la risposta del driver nel formato `SqlResult`:

```typescript
interface SqlResult {
  rows: Record<string, unknown>[];
  resultSets: Record<string, unknown>[][];
  rowsAffected: number[];
}
```

Passa il risultato normalizzato a `processSqlResult()` per applicare i filtri contestuali e registrare l'audit. Gestisci anche l'audit degli errori del driver, come fanno i provider inclusi.

`sqlQuery()` continua a restituire soltanto le righe del primo risultato per gli strumenti di esplorazione. Il generatore collega `execute_query` a `createQueryHandler()` e `createQueryTool()`, che gestiscono le modalità `read` e `write` e la risposta MCP. Adegua `validateReadOnly()` alle parole chiave del motore.

### 4. Completare le query dei metadati

Sostituisci i segnaposto `/* TODO */` con query sul catalogo del motore. Per i parametri usa il sistema di valori associati previsto dal driver, senza concatenare valori utente al testo SQL.

### 5. Registrare il provider

Aggiungi un ramo in `loadProvider()` in `src/index.ts`:

```typescript
if (providerName === "mysql") {
  const m = await import("./providers/mysql/index.js");
  return { provider: m.mysqlProvider, checkEnv: m.checkEnv };
}
```

Aggiorna anche il messaggio dei provider ammessi, `checkEnv()` e l'esempio di configurazione per il nuovo motore.

### 6. Compilare e verificare

Imposta `DB_PROVIDER=mysql` nel `.env`, quindi:

```powershell
npm run build
npm start
```

Per includerlo nell'eseguibile, ricompila con `npm run build:exe`. Lo script controlla che le dipendenze necessarie siano incluse; un driver con componenti nativi o file esterni può richiedere ulteriori interventi sul confezionamento.

## Struttura del progetto e sviluppo

| Percorso | Responsabilità |
|---|---|
| `src/index.ts` | Avvio, scelta del provider, controllo della configurazione e selezione del trasporto |
| `src/core/environment.ts` | Individuazione e caricamento del `.env`, percorsi predefiniti dell'audit |
| `src/core/logging.ts` | Messaggi applicativi su file per l'eseguibile silente e diagnostica stderr per Node.js e stdio |
| `src/core/access.ts` | Lettura e validazione di `SQL_ACCESS_LEVEL` |
| `src/core/server.ts` | Server MCP, trasporti stdio e HTTP, controllo degli argomenti |
| `src/core/query.ts` | Definizione e gestore condivisi di `execute_query`, limiti, risultati e audit |
| `src/core/types.ts` | Tipi condivisi, inclusi `DatabaseProvider` e `SqlResult` |
| `src/core/policy.ts` | Schemi consentiti, tabelle bloccate, mascheramento e limite delle righe |
| `src/core/audit.ts` | Scrittura degli eventi su file e sulla destinazione SQL Server |
| `src/providers/mssql/` | Connessioni, validatore e strumenti SQL Server |
| `src/providers/postgres/` | Connessioni, autenticazione Entra, validatore e strumenti PostgreSQL |
| `scripts/build-exe.mjs` | Creazione dell'eseguibile Windows con esbuild, SEA e postject |
| `scripts/windows-executable.mjs` | Lettura e impostazione del sottosistema Windows silente o con console |
| `scripts/test-query.mjs` | Test delle query con operazioni del driver simulate |
| `scripts/test-exe.mjs` | Test dell'eseguibile in cartelle isolate |
| `scripts/test-connection.mjs` | Prove reali di connessione e scrittura su tabella temporanea |
| `scripts/scaffold-provider.ts` | Generazione dei file iniziali per un nuovo motore |

### Comandi npm

| Comando | Utilizzo |
|---|---|
| `npm run dev` | Esegue `src/index.ts` tramite tsx senza compilazione preventiva |
| `npm run build` | Compila TypeScript in `dist/` |
| `npm start` | Avvia `dist/index.js` con Node.js |
| `npm run build:exe` | Compila e genera `release/sql-mcp.exe` silente su Windows |
| `npm run build:exe -- sql-mcp-next.exe` | Genera un eseguibile con nome alternativo |
| `npm run build:exe -- --console sql-mcp-console.exe` | Genera una variante con console per la diagnosi |
| `npm test` | Compila ed esegue i test di gestione delle query |
| `npm run test:exe` | Verifica il pacchetto eseguibile |
| `npm run test:connection` | Verifica il collegamento al database configurato |
| `npm run test:write` | Verifica le modifiche su una tabella temporanea |
| `npm run inspect` | Avvia MCP Inspector con l'applicazione compilata `dist/index.js` |
| `npm run scaffold -- nome-provider` | Genera un nuovo provider |

`npm run inspect` usa il `.env` principale del progetto e il processo Node.js compilato. Per usarlo tramite stdio, lascia `PORT` non impostata in quella configurazione. Il file `release/.env` viene invece usato dagli eseguibili nella cartella `release/`.

Con Node.js o la variante con console, i messaggi applicativi di avvio e gli errori sono scritti su stderr. La versione Windows silente li salva anche su file e, in modalità HTTP, non emette messaggi sui flussi standard. Il trasporto MCP locale mantiene stdin e stdout per i messaggi di protocollo. Il caricamento di `.env` non stampa messaggi aggiuntivi su stdout.

## Risoluzione dei problemi

| Problema | Verifica |
|---|---|
| Il processo rimane in attesa senza aprire una porta HTTP | Controlla `PORT`: se non è impostata viene usato stdio |
| Il doppio clic non apre una finestra | È il comportamento della versione silente; verifica `http://localhost:3000/`, Gestione attività e `logs/server-YYYY-MM-DD.log` |
| Il processo silente si chiude durante l'avvio | Leggi il file applicativo per controllare configurazione, formato di `PORT`, porta già occupata e permessi della cartella dei log |
| La radice HTTP risponde ma una query fallisce | Esegui `test:connection` e controlla connessione, credenziali e permessi del database |
| Il comando di modifica viene rifiutato come sola lettura | Controlla `SQL_ACCESS_LEVEL`, eventuali variabili del processo con precedenza sul `.env` e la versione dell'eseguibile avviato |
| La query raggiunge il database ma restituisce un errore di permessi | L'utenza deve avere i privilegi richiesti per il comando; `write` non assegna autorizzazioni |
| Una modifica al `.env` non ha effetto | Verifica la posizione del file, le variabili del processo e il riavvio del server |
| La compilazione non può sostituire il file `.exe` | Arresta la copia in uso oppure genera un nome alternativo con `build:exe -- sql-mcp-next.exe` |
| La nuova istanza HTTP non si avvia sulla stessa porta | Arresta la vecchia istanza o assegna un'altra porta |
| `DROP DATABASE` segnala connessioni attive | Usa un altro database di connessione e gestisci le sessioni attive secondo le regole del motore, inclusi i pool già aperti |
| PostgreSQL Entra non riesce ad acquisire il token | Verifica Azure CLI, `az login` e l'associazione del principal al ruolo PostgreSQL |
| I file di audit non vengono creati | Controlla il percorso effettivo di `AUDIT_LOG_PATH`, i permessi di scrittura e stderr |
| `npm ci` o la compilazione Docker segnalano un file di blocco mancante | Esegui `npm install` per generare `package-lock.json` prima di usare questi comandi |
