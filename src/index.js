const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const app = express();
const cors = require('cors');
const server = http.createServer(app);
const PORT = 3000;
const storage = require("./utilities/data");
const { generateDeckOfCards, shuffleDeck } = require('./utilities/helper');

app.use(cors({
    origin: 'http://localhost:3001', // Allow requests from this origin
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true
}));

const io = socketio(server, {
    cors: {
        origin: '*', // Allow all origins
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type'],
        credentials: true
    }
});
 
io.on("connection", socket => {
    console.log('A new socket connection created!');

    socket.on("createUser", name => {
        const result = storage.users.find(item => item["name"].toLowerCase() === name.toLowerCase());
        if(!result){
            let user = {
                id: storage.users.length,
                name: name
            }
            storage.users.push(user);
            socket.emit("user-created", {status: true, data: user});
            socket.join(user.name)
        }
        else{
            socket.emit("user-created", {status: false, message: "User already exist."});
        }
    });

    socket.on("join-room", ({name, roomId}) => {
        let user = storage.users.find(user => user.id === socket.id);

        if(!user){
            user = {
                id: socket.id,
                name: name
            };
            storage.users.push(user);
        }
        let room = storage.rooms.find(r => r.roomId == roomId);
        if(room.createdBy === socketio){
            user = {...user, leader: true};
        }
        else{
            user = {...user, leader: false};
        }

        let table = storage.tables.find(table => table.roomId === roomId);
        if(!table){
            table = {
                id: `${Math.floor(10000000000 + Math.random() * 90000000000)}${storage.tables.length}`,
                roomId: roomId,
                maxPlayer: 4,
                joinedPlayerCount: 0,
                leader: room.createdBy,
                players: [],
                index: storage.tables.length,
                gameStarted: false,
                gameFinished: false
            };

            let updatedPlayers = [...table.players, user];
            table = {...table, joinedPlayerCount: parseInt(table.joinedPlayerCount) + 1, players: [...updatedPlayers]};
            storage.tables.push(table);
        }
        else{
            if(!table.gameStarted && table.joinedPlayerCount < table.maxPlayer){
                let player = table.players.find(player => player.id === user.id);
                if(!player){
                    let updatedPlayers = [...table.players, user];
                    storage.tables[table.index] = {...table, joinedPlayerCount: parseInt(table.joinedPlayerCount) + 1, players: [...updatedPlayers]};
                }
            }
            else{
                socket.emit("room-full", {status: true, message: "Room is already full/Game started. Please Join another room or create new one."});
                return false;
            }
        }
        socket.join(roomId);
        socket.emit("room-joined", {status: true, data: table});

        socket.broadcast.to(roomId).emit("new-user-joined", {status: true, data: storage.tables[table.index]});
        socket.broadcast.to(roomId).emit("message", {status: true, message: `${user.name} just joined the lobby!`});
    });

    socket.on("request-table-details", tableId => {
        let table = storage.tables.find(table => table.id == tableId);
        console.log(storage.tables)
        socket.emit("get-table-details", {status: true, data: table});
    });

    socket.on("create-room", () => {
        try{
            let room = {
                _id: storage.rooms.length,
                roomId: `${Math.floor(1000 + Math.random() * 9000)}-${storage.rooms.length}`,
                maxPlayer: 4,
                joinedPlayerCount: 0,
                createdBy: socket.id
            }
            storage.rooms.push(room);
            socket.emit("room-created", {status: true, data: room});
        }
        catch(e){
            socket.emit("room-created", {status: false, message: e});
        }

    });

    socket.on("start-game", tableId => {
        let table = storage.tables.find(tab => tab.id === tableId);
        // Lock the table so that no one can join after that
        storage.tables[table.index]["gameStarted"] = true;

        // Generate a deck of cards
        const deck = generateDeckOfCards();

        // Shuffle the deck of cards
        const shuffledDeck = shuffleDeck(deck);

        let entries = [];
        for(let i=0; i<table.players.length; i++){
            let item = {
                player: table.players[i],
                grabCards: [],
                score: 0
            }
            entries.push(item);
        }

        const openedCard = new Array(52).fill(0);
        // create game log
        let gameLog = storage.games.find(game => game.tableId === table.id);
        if(!gameLog){
            gameLog = {
                id: `game-${Math.floor(10000000000 + Math.random() * 90000000000)}`,
                tableId: tableId,
                roomId: table.roomId,
                gameStarted: true,
                gameFinished: false,
                openedCard: [...openedCard],
                scoreCard: entries,
                turn: 0,
                winner: null,
                gameLog
            }
            storage.games.push(gameLog);
        }

        let gameDeck = storage.gameDecks.find(de => de.tableId == gameLog.tableId);
        if(!gameDeck){
            gameDeck = {
                id: storage.gameDecks.length,
                tableId: gameLog.tableId,
                deck: [...deck]
            }
            storage.gameDecks.push(gameDeck);
        }
        
        socket.broadcast.to(table.roomId).emit("game-started", {status: true, message: "Best of luck for the game!", data: gameLog, table: table, gameDeck: gameDeck});
        socket.emit("game-started", {status: true, message: "Best of luck for the game!", data: gameLog, table: table, gameDeck: gameDeck});
    });

    socket.on("open-card", ({tableId, index}) => {
        let gameLog = storage.games.find(game => game.tableId === tableId);
        
        if(gameLog){
            const gameDeck = storage.gameDecks.find(gd => gd.tableId == tableId);
            const popCard = gameDeck.deck[index];
            let open_cards = [...gameLog.openedCard];
            open_cards[index] = popCard;
            gameLog.openedCard = open_cards;

            io.to(gameLog.roomId).emit("card-opened", {status: true, data: gameLog});
        }
        else{
            socket.emit("error", {status: false, data: "Something went wrong. Game log is not there restart the game."});
        }

    });
});

server.listen(PORT, (req, res)=>{
    console.log(`Seep web socket server is listening on PORT ${PORT}`);
});