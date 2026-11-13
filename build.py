"""Add result-based world ranking hooks to the original self-contained game."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parent
source = Path(sys.argv[1]).read_text()

def change(old, new):
    global source
    if source.count(old) != 1:
        raise RuntimeError('Unexpected game version at ' + old[:70])
    source = source.replace(old, new)

def read(path):
    return (root / path).read_text()

change('</style>', read('public/leaderboard.css') + '</style>')
change('TIME ATTACK ▶</button>', 'START ▶</button>')
change('</ul></details>', '<li>World rank counts doors cleared, then progress toward the next door.</li></ul></details>')
change('<button class="mainButton" id="retry">', '''<div class="rankResult">
<p id="deviceBest"></p><p id="myRank" aria-live="polite"></p>
<form id="rankForm" hidden><label for="rankName">Nickname</label><div class="entry"><input id="rankName" maxlength="36" autocomplete="nickname" required><button class="rankLink">Post record</button></div></form>
<p id="rankMessage" role="status"></p><button id="retryRank" class="rankLink" hidden>Retry upload</button>
<button id="resultRanks" class="rankLink">World ranking</button></div><button class="mainButton" id="retry">''')
change('</main><script>', '''</main><dialog id="worldBoard" aria-labelledby="rankHeading">
<header><h2 id="rankHeading">WORLD TOP 100</h2><button id="closeRank" class="rankLink">Close</button></header>
<p id="boardMe"></p><button id="shareRank" class="rankLink" disabled>Share record</button><p id="boardStatus" role="status"></p>
<table><thead><tr><th>Rank</th><th>Player</th><th>Doors</th><th>Next door</th></tr></thead><tbody id="rankRows"></tbody></table></dialog><script>'''
    + read('server/door-score.mjs').replace('export function', 'function') + read('public/leaderboard.js') + '\n')
change("const firstStart=phase==='title';", "const firstStart=phase==='title';leaderboard.prepare();")
change('function go(){', 'function go(){\n const seed=leaderboard.begin();if(seed!==undefined)state=initial(state.bestLap,seed);')
change('if(pushUphill(state,side))showPush();', "if(pushUphill(state,side)){leaderboard.event('push',side);showPush();}")
change('advance(state,held());', 'const direction=held();advance(state,direction);leaderboard.event(direction,1);')
change('state.raceTicks+=skipped;', "leaderboard.event('gap',skipped);state.raceTicks+=skipped;")
change('function timeUp(){', 'function timeUp(){\n leaderboard.finished(state);')
change("'LAPS COMPLETED: '+state.completed,", "'NEXT DOOR: '+doorScore(state,gateDistance).progress+'%',\n 'LAPS COMPLETED: '+state.completed,")
(root / 'public/index.html').write_text(source)
