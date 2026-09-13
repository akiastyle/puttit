<!-- README.md v1.0.124 -->
# Puttit

Puttit è un client SSH interattivo centralizzato per la LAN.

## Obiettivo

Un utente apre il browser, accede, sceglie uno dei server assegnati e usa una
console SSH interattiva. Il dispositivo dell'utente non riceve credenziali SSH
né dettagli tecnici della connessione.

## Flusso principale

```text
login → server autorizzati → collega → terminale web → scollega
```

La prima versione deve completare questo flusso prima di aggiungere MCP o
funzioni accessorie.

## Ruoli

### Amministratore

- crea e disabilita gli utenti;
- configura server e credenziali SSH;
- assegna gli accessi;
- vede chi è collegato, a quale server, da quando e lo stato della sessione;
- può terminare una sessione.

L'amministratore non vede il contenuto del terminale, i comandi digitati o
l'output prodotto.

Anche l'amministratore deve ricevere un accesso esplicito per collegarsi via
SSH. Usa lo stesso percorso operativo di user e guest, senza scorciatoie, così
può collaudare esattamente server e identità assegnati.

### Utente e ospite

Possono soltanto:

- elencare gli accessi assegnati;
- aprire una connessione;
- usare il terminale;
- chiudere la connessione.

Non possono creare o modificare utenti, server, credenziali, autorizzazioni o
impostazioni.

## Confini tecnici

- servizio disponibile esclusivamente nella LAN sulla porta `11414`;
- client tramite browser, senza installazione;
- server supportato su Windows, Linux e macOS;
- terminale nel browser con xterm.js;
- sessione SSH persistente gestita esclusivamente dal server Puttit;
- credenziali cifrate e mai inviate al browser;
- verifica obbligatoria della chiave host SSH;
- TLS e autenticazione a due fattori;
- nessuna registrazione di comandi, output o contenuto del terminale;
- in caso di autorizzazione o stato incerto la sessione viene chiusa;
- MCP sarà aggiunto soltanto dopo il completamento del client standalone.

## Primo traguardo

Una connessione configurata dall'amministratore deve aprire nel browser una
vera shell SSH interattiva, con input, output, ridimensionamento e chiusura
corretti.

## Stato attuale

Sono disponibili il nucleo SSH interattivo e il pannello amministrativo per:

- creare il primo amministratore con password e TOTP;
- creare, disabilitare e assegnare ruoli agli utenti;
- configurare per ogni ospite una durata massima fino a 10 ore oppure
  l'approvazione amministrativa di ogni tentativo SSH;
- configurare separatamente server e fingerprint SSH;
- creare identità remote con password o chiave privata;
- assegnare a ogni persona una precisa coppia server/identità SSH.
- approvare o rifiutare le richieste guest;
- vedere e chiudere le sessioni attive senza accedere al terminale.

Il server descrive la destinazione, l'identità SSH contiene l'account remoto e
la sua credenziale, l'accesso collega una persona a quell'identità. Più persone
possono condividere un account remoto oppure usare account differenti sullo
stesso server senza duplicare la configurazione dell'host.

Con l'approvazione manuale, il login e l'assegnazione rendono visibile il
collegamento ma non avviano SSH: ogni richiesta dovrà essere accettata
dall'amministratore. Il pannello mostrerà soltanto persona, server, orario e
stato, mai comandi o contenuto del terminale.

Il coordinatore produce eventi minimi per richiesta di approvazione, apertura e
chiusura della sessione. Gli eventi non contengono comandi o output e saranno
inoltrati soltanto attraverso i canali scelti dall'amministratore.

Richieste e sessioni sono stato operativo in memoria: al riavvio di Puttit
vengono eliminate e le connessioni vengono chiuse. Non finiscono
nell'archivio persistente.

Le credenziali SSH sono contenute esclusivamente nello stato cifrato e non
vengono restituite dall'API. Fino all'aggiunta di TLS il processo accetta
soltanto connessioni locali.

Per lo sviluppo imposta una chiave Base64 di 32 byte e avvia il server:

```sh
PUTTIT_MASTER_KEY="$(openssl rand -base64 32)" npm start
```

Apri `http://127.0.0.1:11414`. La chiave di sviluppo è temporanea: riutilizza
la stessa chiave per riaprire i dati creati durante una sessione precedente.

## Server raggiungibili tramite VPN

Un server può essere indicato come diretto oppure raggiungibile tramite una VPN
già attiva sul sistema che esegue Puttit. L'amministratore assegna un nome alla
VPN e può verificare dal pannello se la porta SSH è raggiungibile. Puttit non
avvia, arresta o configura il tunnel e non conserva credenziali VPN.

La verifica conferma la raggiungibilità TCP, non il percorso seguito dai
pacchetti: routing e firewall del sistema devono impedire che una destinazione
riservata alla VPN sia raggiunta da un'altra interfaccia.
