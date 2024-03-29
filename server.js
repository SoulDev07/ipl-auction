import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";

import errorHandler from "./middlewares/errorMiddleWare.js";
import Players from "./models/player.js";
import User from "./models/user.js";

dotenv.config();
const ONE_CR = 1e7;
const TEAMS = ["CSK", "DC", "GT", "KKR", "LSG", "MI", "PBKS", "RCB", "RR", "SRH"];
const POWERCARDS = ["focus fire", "god's eye", "right to match", "double right to match", "silent reserve", "stealth bid",];

const app = express();

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PATCH'],
    },
});

const PORT = process.env.PORT || 3000;
const CONNECTION_URL = `mongodb+srv://IPL_AUCTION_24:${process.env.PASSWORD}@cluster0.ilknu4v.mongodb.net/IPL?retryWrites=true&w=majority`;

mongoose.connect(CONNECTION_URL)
    .then(() => console.log('Connected to MongoDB successfully'))
    .catch(err => console.log(`No connection to MongoDB\nError:\n${err}`));

io.on('connection', (socket) => {
    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

function emitChanges(endpoint, payload) {
    io.emit(endpoint, { payload });
}

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
    res.send("<h1>Hello from the IPL Server 👋</h1>");
});

// Route for user login
app.post("/login", async (req, res, next) => {
    try {
        const { username, password, slot } = req.body;

        const user = await User.findOne({ username, slot });

        if (!user)
            return res.send({ message: "user not found" });

        if (password === user.password)
            res.send({ message: "login successful", user });
        else
            res.send({ message: "password does not match" });
    } catch (err) {
        console.log(err);
        next(err);
    }
});

// const validatePlayerConditions = async (user) => {

//     const playerCards = user.players;

//     const counts = {
//         "Batsman": 0,
//         "Bowler": 0,
//         "All Rounder": 0,
//         "Wicket Keeper": 0,
//         "foreign": 0,
//         "women": 0,
//         "underdogs": 0,
//         "legendary": 0
//     };

//     playerCards.forEach(card => {
//         counts[card.type]++;
//         if (card.gender === 'female') {
//             counts['women']++;
//         }
//         if (card.gender === 'legendary') {
//             counts['legendary']++;
//         }
//     });

//     const conditions = {
//         "Batsman": { min: 2, max: 4 },
//         "Bowler": { min: 2, max: 4 },
//         "All Rounder": { min: 2, max: 3 },
//         "Wicket Keeper": { min: 1, max: 1 },
//         "foreign": { min: 0, max: 4 },
//         "women": { min: 1, max: 1 },
//         "underdogs": { min: 1, max: 1 },
//         "legendary": { min: 1, max: 1 }
//     };

//     let allConditionsMet = true;
//     for (const type in conditions) {
//         const { min, max } = conditions[type];
//         const count = counts[type];
//         const conditionMet = count >= min && count <= max;
//         if (!conditionMet) {
//             allConditionsMet = false;
//         }
//     }

//     return allConditionsMet;
// };

// Function to add or delete a Player
const managePlayer = async (teamName, slot, playerName, price, action) => {
    try {
        const user = await User.findOne({ teamName, slot });

        if (!user)
            return { message: "User not found!" };

        const player = await Players.findOne({ playerName });

        if (!player)
            return { message: "Player not found!" };

        if (action === "add") {
            // Check if the player is already sold in the given slot
            const isAlreadySold = player.isSold.some(item => item.slot === slot);
            if (isAlreadySold)
                return { message: `Player is already sold in slot number ${slot}` };

            const newbudget = user.budget - (price * ONE_CR);

            if (newbudget < 0)
                return { message: "Not enough budget" };

            // if (!validatePlayerConditions(player, user)) 
            //     return { message: "Player does not meet the conditions" };

            // Sell the player
            player.isSold.push({ slot: slot, budget: price * ONE_CR });
            user.budget = newbudget;
            user.players.push(player._id);
        }
        else if (action === "delete") {
            const playerIndex = user.players.findIndex(playerId => playerId.equals(player._id));

            if (playerIndex === -1)
                return { message: "Player does not exist with this user" };

            // Remove player
            const soldIndex = player.isSold.findIndex(item => item.slot === slot);
            if (soldIndex === -1)
                return { message: "Player was not sold with this slot" };

            // Add the price back in which the player was sold 
            const playerPrice = player.isSold[soldIndex].budget;
            player.isSold.splice(soldIndex, 1);
            user.budget = user.budget + playerPrice;
            user.players.splice(playerIndex, 1);
        }
        else {
            return { message: "Invalid action" };
        }

        await Promise.all([user.save(), player.save()]);

        const endpoint = `${action === "add" ? "playerAdded" : "playerDeleted"}${teamName}${slot}`;
        const payload = { playerID: player._id, budget: user.budget };
        emitChanges(endpoint, payload);

        return { message: `${action === "add" ? "New Player added" : "Player deleted"} successfully`, player, user };
    } catch (err) {
        console.log(err);
        throw err;
    }
};

// Route to add a Player
app.post("/adminAddPlayer", async (req, res, next) => {
    try {
        const { playerName, teamName, slot, price } = req.body;
        const result = await managePlayer(teamName, slot, playerName, price, "add");
        res.send(result);
    } catch (err) {
        next(err);
    }
});

// Route to delete a Player
app.post("/adminDeletePlayer", async (req, res, next) => {
    try {
        const { playerName, teamName, slot } = req.body;
        const result = await managePlayer(teamName, slot, playerName, 0, "delete");
        res.send(result);
    } catch (err) {
        next(err);
    }
});

// Route to get Player Info
app.post("/getPlayer", async (req, res, next) => {
    try {
        const { _id } = req.body;
        const player = await Players.findOne({ _id });

        if (!player)
            return res.send({ message: "Player not found" });

        res.send(player);
    } catch (err) {
        console.log(err);
        next(err);
    }
});

// Function to add or use a Powercard
const managePowercard = async (teamName, slot, powercard, action) => {
    try {
        if (!POWERCARDS.some(pc => pc === powercard))
            return { message: "Powercard not found" };

        const user = await User.findOne({ teamName, slot });

        if (!user)
            return { message: "User not found" };

        const result = user.powercards.find(pc => pc.name === powercard);

        if (action === "add") {
            if (result)
                return { message: "Powercard already present" };

            // Add the Powercard
            user.powercards.push({ name: powercard, isUsed: false });
            await user.save();

            const endpoint = `powercardAdded${teamName}${slot}`;
            const payload = user.powercards;
            emitChanges(endpoint, payload);

            return { message: "Powercard added successfully", user };
        }
        else if (action === "use") {
            if (!result)
                return { message: "User does not have this powercard" };

            // Use the Powercard
            result.isUsed = true;
            await user.save();

            const endpoint = `usePowerCard${teamName}${slot}`;
            const payload = user.powercards;
            emitChanges(endpoint, payload);

            return { message: "Powercard used successfully", user };
        }
        else {
            return { message: "Invalid action" };
        }
    } catch (err) {
        console.log(err);
        throw err;
    }
};

// Route to add a Powercard
app.post("/adminAddPowercard", async (req, res, next) => {
    try {
        const { teamName, slot, powercard } = req.body;
        const result = await managePowercard(teamName, slot, powercard, "add");
        res.send(result);
    } catch (err) {
        next(err);
    }
});

// Route to use a Powercard
app.post("/adminUsePowercard", async (req, res, next) => {
    try {
        const { teamName, slot, powercard } = req.body;
        const result = await managePowercard(teamName, slot, powercard, "use");
        res.send(result);
    } catch (err) {
        next(err);
    }
});

// Route to store Score
app.post("/calculator", async (req, res, next) => {
    try {
        const { teamName, slot, score } = req.body;

        const user = await User.findOne({ teamName, slot });

        if (!user)
            return res.send({ message: "User not found" });

        // Save the score
        user.score = score;
        await user.save();

        const endpoint = `scoreUpdate${slot}`;
        const payload = {
            teamName: teamName,
            score: score
        };
        emitChanges(endpoint, payload);

        res.send({ message: "Score updated successfully", user });
    } catch (err) {
        console.log(err);
        next(err);
    }
});

// Route to Allocate team
app.patch("/adminAllocateTeam", async (req, res, next) => {
    try {
        const { teamName, username, slot, price } = req.body;

        if (!TEAMS.some(team => team === teamName))
            return res.send({ message: "Teamname not found" });

        const user = await User.findOne({ username, slot });

        if (!user)
            return res.send({ message: "User not found" });

        const newbudget = user.budget - (price * ONE_CR);

        if (newbudget < 0)
            return res.send({ message: "Not enough budget" });

        // Allocate Team
        user.teamName = teamName;
        user.budget = newbudget
        await user.save();

        const endpoint = `teamAllocate${username}${slot}`;
        const payload = {
            teamName: teamName,
            budget: newbudget
        };
        emitChanges(endpoint, payload);

        res.send({ message: "Team allocated successfully", user });
    } catch (err) {
        console.log(err);
        next(err);
    }
});

// Route to Spectate
app.post("/spectate/:teamName", async (req, res, next) => {
    try {
        const teamName = req.params.teamName;
        const { slot } = req.body;

        const user = await User.findOne({ teamName, slot });

        if (!user)
            return res.send({ message: "User not found" });

        const spectateTeam = {
            slot: user.slot,
            teamName: user.teamName,
            budget: user.budget,
            score: user.score,
            players: user.players,
            powercards: user.powercards
        };

        res.send({ spectateTeam: spectateTeam });
    } catch (err) {
        console.log(err);
        next(err);
    }
});

app.get("/test", async (req, res, next) => {
    try {
        const allPlayers = await Players.find();
        const user = await User.findOne({ teamName: "MI", slot: 2 });

        for (const player of allPlayers) {
            const isAlreadySold = player.isSold.some(item => item.slot === 2);
            if (isAlreadySold)
                continue;

            player.isSold.push({ slot: 2, budget: 1 * ONE_CR });
            user.players.push(player._id);
            await player.save();
        }
        await user.save();
        res.send({ message: "/test" });
    } catch (err) {
        console.log(err);
        next(err);
    }
});

server.listen(PORT, () => {
    console.log(`listening on port ${PORT}`);
});

app.use(errorHandler);
