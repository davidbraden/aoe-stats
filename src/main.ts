
import express from 'express';
import { Storage } from '@google-cloud/storage';
import { load } from 'cheerio';
import cors from 'cors';


const BUCKET = 'aoe-stats.davidbraden.co.uk';

const PLAYERS: Player[] = [
    {
        name: 'Calum',
        profile_id: '4854548',
        steam_id: '76561198037279369',
    },
    {
        name: 'Tedo',
        profile_id: '4657043',
        steam_id: '76561198220073969',
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

interface MatchPlayer {
    name: string
    profile_id: string
    won: boolean
    civ: string
}

interface Match {
    match_id: string
    players: MatchPlayer[]
    mode: string
    map: string
}

const createPlayerStats = async (): Promise<void> => {
    const storage = new Storage();
    const contents = await storage.bucket(BUCKET).file(`api/matches.json`).download();
    const json = JSON.parse(contents.toString());

    const allMatches: Map<string, any> = new Map(Object.entries(json));

    const matchesWithResult = [...allMatches.values()].filter(m => m.players.some(r => r.won == true) &&  m.players.some(r => r.won == false));

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

const getExistingMatches = async (): Promise<Map<string, Match>> => {
    const storage = new Storage();
    let matches: Map<string, Match>;
    try {
        const contents = await storage.bucket(BUCKET).file(`api/matches.json`).download();
        const json = JSON.parse(contents.toString());
        const matchArray = Object.entries<any>(json).map(tuple => <Match>{
            match_id: tuple[0],
            players: tuple[1].players.map(p => ({
                name: p.name,
                profile_id: p.profile_id,
                won: p.won,
            })),
        });
        matches = new Map(matchArray.map(m => [m.match_id, m]));
    } catch {
        matches = new Map();
    }
    return matches
}

// const triggerPlayerDataRefresh = async (player_id: string): Promise<void> => {

// }

const findNewMatches = async (player_id: string, existing_matches: Set<string>): Promise<Set<string>> => {
    let page = 1;
    let result = new Set<string>();
    while (true) {
        const url = `https://www.aoe2insights.com/user/${player_id}/matches/?page=${page}`;
        console.log(`Fetching ${url}`);
        const response = await fetch(url);
        const html = await response.text();
        const $ = load(html);
        const links = $('a').toArray().map(l => l.attribs['href']);
        const matchLinks = links.filter(l => l && l.startsWith('/match/'));
        const matches = new Set(matchLinks.map(l => l.split('/')[2]));
        const newMatches = [...matches].filter(m => !existing_matches.has(m));
        result = new Set([...newMatches, ...result]);
        const pageHasExistingMatches = [...matches].filter(m => existing_matches.has(m)).length > 0;
        if (!pageHasExistingMatches && newMatches.length > 0) {
            page += 1
        } else {
            return result;
        }
    }
}

const fetchMatch = async (match_id: string): Promise<string> => {
    console.log(`Fetching match ${match_id}`);
    const url = `https://www.aoe2insights.com/match/${match_id}/`;
    const response = await fetch(url);
    return await response.text();
}

const parseMatch = (match_id: string, html: string): Match  => {
    const $ = load(html);
    const playerLinks = $('.match table a').toArray();
    const civs = $('.match td:nth-child(3)').toArray().map(c => $(c).text().trim());
    const players = playerLinks.map((p, i) => ({
        name: $(p).text().trim(),
        profile_id: p.attribs['href'].split('/')[2],
        won: !$(p).parent().hasClass('player-won'),
        civ: civs[i]
    }));
    const mode = $('th:contains(Game mode)').parent().find('td').text();
    const map = $('th:contains(Location)').parent().find('td').text();
    return {
        match_id,
        players,
        map,
        mode
    }
}

const saveMatches = async (matches: Map<string, Match>): Promise<void> => {
    const storage = new Storage();
    await storage.bucket(BUCKET).file(`api/matches.json`).save(JSON.stringify(Object.fromEntries(matches)));
}


const app = express();
app.use(cors({
    origin: 'http://aoe-stats.davidbraden.co.uk'
}));

app.get('/refresh', async (req, res) => {
    const matches = await getExistingMatches();
    const existing_matches: Set<string> = new Set(matches.keys());
    console.log(`${existing_matches.size} existing matches`)

    let new_matches = new Set<string>();
    for (const player of PLAYERS) {
        const player_new_matches = await findNewMatches(player.profile_id, existing_matches);
        new_matches = new Set([...player_new_matches, ...new_matches]);
    }

    if (new_matches.size > 0) {
        console.log(`Found ${new_matches.size} new matches`)
        for (const match_id of new_matches) {
            const matchHtml = await fetchMatch(match_id);
            const match = parseMatch(match_id, matchHtml);
            matches.set(match.match_id, match);
        }
        await saveMatches(matches);
    }

    await createPlayerStats();

    res.send(`Stats updated`);
});

function eqSet(as, bs) {
    if (as.size !== bs.size) return false;
    for (var a of as) if (!bs.has(a)) return false;
    return true;
}

app.get('/players-matches', async (req, res) => {
    const matches = await getExistingMatches();
    const players = new Set(req.query.player)
    
    const playersMatches = [...matches.values()].filter(m => eqSet(new Set(m.players.map(p => p.name)), players))
    
    res.json(playersMatches);
});

const port = parseInt(process.env.PORT || '8080');

app.listen(port, () => {
  console.log(`aoe-stats-updater: listening on port ${port}`);
});


(async () => {
    
})()
