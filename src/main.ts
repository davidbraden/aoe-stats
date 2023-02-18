
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
        name: 'waluwewe',
        profile_id: '1533683',
        steam_id: '76561198058125099',
    },
    {
        name: 'Simie',
        profile_id: '1512338',
        steam_id: '76561197988289178',
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
        profile_id: '1609821',
        steam_id: '',
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

const ABANDONED_MATCHES = [
    '209876620',
]

interface Player {
    name: string,
    profile_id: string,
    steam_id: string
}
type TeamMateWins = { 
    [id: string]: number; 
}

interface PlayerStats {
    player: Player,
    games: number,
    wins: number,
    overallWinRate: number,
    winRateLast10: number,
    results: boolean[],
    teamMateWins: TeamMateWins,
}

interface MatchPlayer {
    name: string
    profile_id: string
    won: boolean
}

interface Match {
    match_id: string
    players: MatchPlayer[]
}

const createPlayerStats = (allMatches: Map<string, Match>): PlayerStats[] => {
    const matchesWithResult = [...allMatches.values()].filter(m => m.players.some(r => r.won == true) &&  m.players.some(r => r.won == false));

    const matchesWithNoOutsiders = matchesWithResult.filter(
        m => ! m.players.some(mp => !PLAYERS.map(p => p.name).includes(mp.name))
    );
    const sortedMatches = matchesWithNoOutsiders.sort((m1, m2) => parseInt(m2.match_id) - parseInt(m1.match_id));

    const stats: PlayerStats[] = [];

    for (const player of PLAYERS) {
      const results = sortedMatches
        .flatMap((m) => m.players)
        .filter((p) => p.profile_id == player.profile_id)
        .map((p) => p.won);
      const wins = results.filter((r) => r).length;
      const overallWinRate = wins / results.length || 0;
      const last10wins = results.slice(0, 10).filter((r) => r).length;
      const winRateLast10 = last10wins / Math.min(10, results.length) || 0;
      const teamMates = PLAYERS.filter(
        (p) => p.profile_id != player.profile_id
      );
      const teamMateWins = 
        teamMates.map((team_mate) => {
          const matcheWonWithTeamMate = sortedMatches
            .filter((m) =>
              m.players.some((p) => p.profile_id == player.profile_id && p.won)
            )
            .filter((m) =>
              m.players.some(
                (p) => p.profile_id == team_mate.profile_id && p.won
              )
            );
          return {
            [team_mate.name]: matcheWonWithTeamMate.length,
          };
        })
        .reduce((a, b) => Object.assign(a, b), {});
      const playerStats = {
        player,
        games: results.length,
        wins,
        overallWinRate,
        winRateLast10,
        results: results.slice(0, 10),
        teamMateWins,
      };
      stats.push(playerStats);
    }
    return stats;
}

const saveStats = async (stats: PlayerStats[]): Promise<void> => {
    const storage = new Storage();
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

const getPlayerMatches = async (player_id: string, page: string): Promise<Match[]> => {
    const url = `https://www.aoe2insights.com/user/${player_id}/matches/?page=${page}`;
    console.log(`Fetching ${url}`);
    try {
        const response = await fetch(url);
        const html = await response.text();
        const $ = load(html);
        const matchTiles = $("div.match-tile").toArray();
        const matches = matchTiles.map((tile) => {
        const links = $("a", tile)
            .toArray()
            .map((l) => l.attribs["href"]);
        const match_id = links
            .find((l) => l && l.startsWith("/match/"))
            .split("/")[2];

        const teams = $("ul.team", tile).toArray();
        const players = teams
            .map((team) => {
            const teamPlayers = $("a", team)
                .toArray()
                .map((player) => {
                const profile_id = player.attribs["href"].split("/")[2];
                const name = $(player).text().trim();
                const won = $("i.won", team).toArray().length > 0;
                return {
                    name,
                    profile_id,
                    won,
                };
                });
            return teamPlayers;
            })
            .flat();
        return {
            match_id,
            players,
        };
        });
        return matches;
    } catch {
        return [];
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
    console.log(`${matches.size} existing matches`)

    for (const player of PLAYERS) {
        for (let i = 1; i< 7; i++) {
            const newMatches = await getPlayerMatches(player.profile_id, i.toString());
            newMatches.forEach(m => {
                matches.set(m.match_id, m)
            });
        }
    }
    ABANDONED_MATCHES.forEach(match_id => {
        matches.delete(match_id);
    });
    await saveMatches(matches);
    const stats = createPlayerStats(matches);
    await saveStats(stats)

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
    const matches = await getExistingMatches();
    const s = createPlayerStats(matches);
    console.log(JSON.stringify(s))
})()
