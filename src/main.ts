
import express from 'express';
import { Storage } from '@google-cloud/storage';


const BUCKET = 'aoe-stats.davidbraden.co.uk';

const PLAYERS: Player[] = [
    {
        name: 'Calum',
        profile_id: '4854548',
        steam_id: '76561198037279369',
    },
    {
        name: 'RAD',
        profile_id: '2418734',
        steam_id: '76561197993028790',
    },
    {
        name: 'Simie',
        profile_id: '1512338',
        steam_id: '76561197988289178',
    },
    {
        name: 'Tedo',
        profile_id: '4657043',
        steam_id: '76561198220073969',
    },
    {
        name: 'waluwewe',
        profile_id: '1533683',
        steam_id: '76561198058125099',
    },
    {
        name: 'David',
        profile_id: '1948286',
        steam_id: '76561197973846564',
    },
    {
        name: 'Venko',
        profile_id: '2518648',
        steam_id: '76561198066791332',
    },
    {
        name: 'watman',
        profile_id: '1534464',
        steam_id: '76561197966056001',
    },
    {
        name: 'Le NG',
        profile_id: '2932142',
        steam_id: '76561197996434115',
    },
    {
        name: 'Jomoes',
        profile_id: '2932142',
        steam_id: '76561197996434115',
    },
    {
        name: 'andkins',
        profile_id: '2334344',
        steam_id: '76561198135323642',
    },
    {
        name: 'bethatk',
        profile_id: '2665755',
        steam_id: '76561199040231872',
    },
];

interface Player {
    name: string,
    profile_id: string,
    steam_id: string
}

interface PlayerStats {
    player: Player,
    games: number,
    overallWinRate: number,
    winRateLast10: number,
    results: boolean[],
    // teamMateWinPercent: Map<string, number>,
}


const getMatches = async (profile_id: string): Promise<string> => {
    const url = `https://aoe2.net/api/player/matches?game=aoe2de&profile_id=${profile_id}&count=1000`;
    const response = await fetch(url);
    return await response.text();
}

const rawPath = (): string => `raw/dt=${new Date(Date.now()).toISOString().slice(0, 10)}`;

const storeRawMatchesToGCS = async (): Promise<void> => {
    const storage = new Storage();
    for (const p of PLAYERS) {
        const response = await getMatches(p.profile_id);
        const blobName = `${rawPath()}/${p.profile_id}`;
        await storage.bucket(BUCKET).file(blobName).save(response);
    }
}

const aggregateAllMatches = async (): Promise<void> => {
    const storage = new Storage();
    let allMatches: Map<string, any>;
    try {
        const contents = await storage.bucket(BUCKET).file(`api/matches.json`).download();
        const json = JSON.parse(contents.toString());
        allMatches = new Map(Object.entries(json));
    } catch {
        allMatches = new Map();
    }
    for (const p of PLAYERS) {
        const contents = await storage.bucket(BUCKET).file(`${rawPath()}/${p.profile_id}`).download();
        const matches: any[] = JSON.parse(contents.toString());
        matches.forEach(m => {
            allMatches.set(m.match_id, m);
        });
    }
    await storage.bucket(BUCKET).file(`api/matches.json`).save(JSON.stringify(Object.fromEntries(allMatches)));
}

const createPlayerStats = async (): Promise<void> => {
    const storage = new Storage();
    const contents = await storage.bucket(BUCKET).file(`api/matches.json`).download();
    const json = JSON.parse(contents.toString());

    const allMatches: Map<string, any> = new Map(Object.entries(json));

    const matchesWithResult = [...allMatches.values()].filter(m => m.players.some(r => r.won != null));

    const matchesWithNoOutsiders = matchesWithResult.filter(
        m => ! m.players.some(mp => !PLAYERS.map(p => p.name).includes(mp.name))
    );
    const sortedMatches = matchesWithNoOutsiders.sort((m1, m2) => m2.match_id - m1.match_id);

    const stats: PlayerStats[] = [];

    for (const player of PLAYERS) {
        const results = sortedMatches.flatMap(m => m.players).filter(p => p.name == player.name).map(p => p.won);
        const wins = results.filter(r => r).length;
        const overallWinRate = (wins / results.length) || 0;
        const last10wins = results.slice(0, 10).filter(r => r).length;
        const winRateLast10 = (last10wins / Math.min(10, results.length)) || 0;
        const playerStats = {
            player,
            games: results.length,
            overallWinRate,
            winRateLast10,
            results: results.slice(0, 10),
        };
        stats.push(playerStats);
    }
    await storage.bucket(BUCKET).file(`api/player-stats.json`).save(JSON.stringify(stats), { metadata: { cacheControl: 'public, max-age=15' }});
}

const app = express();

app.get('/refresh', async (req, res) => {
    await storeRawMatchesToGCS();

    await aggregateAllMatches();

    await createPlayerStats();

    res.send(`Stats updated`);
});

const port = parseInt(process.env.PORT || '8080');

app.listen(port, () => {
  console.log(`aoe-stats-updater: listening on port ${port}`);
});
