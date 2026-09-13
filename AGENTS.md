<!-- AGENTS.md v1.0.36 -->
# Regole operative di Puttit

## Versionamento obbligatorio dei file

Ogni file mantenuto nel progetto ha una propria versione `X.Y.Z`, separata
dalla versione dell'applicazione e dalla versione Git.

- `X` parte da `1` e aumenta di `1` ogni 1000 variazioni accumulate in `Z`.
- `Y` parte dal numero di funzioni presenti quando il file viene creato.
- `Z` parte dal numero di righe presenti quando il file viene creato.
- Aggiungere o eliminare una funzione aumenta `Y` di `1`; `Y` non diminuisce.
- Aggiungere, eliminare o modificare una riga valida aumenta `Z` di `1`; una
  sostituzione della stessa riga vale una variazione, non due.
- Le righe di commento, l'intestazione di versione e le sole righe di apertura
  o chiusura di una funzione non aumentano `Z` nelle modifiche successive.
- Il corpo aggiunto, eliminato o modificato di una funzione aumenta normalmente
  `Z`, una volta per ogni riga interessata.
- Quando una modifica tocca più file, si aggiornano soltanto le versioni dei
  file realmente modificati.
- I contatori sono storici: dopo la creazione non si ricalcolano dal contenuto
  corrente e non si riducono eliminando codice.

Per il conteggio iniziale di `Y`, sono funzioni le dichiarazioni nominate, le
funzioni freccia assegnate a un nome e i metodi. Le callback anonime non sono
conteggiate. I file senza funzioni partono da `Y=0`.

La versione compare nella prima riga utile con il nome del file, per esempio:

```js
// ssh.mjs v1.13.144
```

Per i formati JSON si usa la proprietà `fileVersion`. I file generati devono
essere riallineati quando il generatore li riscrive. Prima di ogni commit si
verificano e aggiornano le versioni di tutti i file modificati.
