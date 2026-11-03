import { useState, useEffect } from "react";
import { storageGet, storageSet, storageSubscribe } from "./storage";

// ─── Constants ────────────────────────────────────────────────────────────────
const COURSES = [
  { id: 1, name: "The Quarry at La Quinta",    day: "Day 2",    format: "2v2 Best Ball (Net)", type: "bestball", gameType: "bestball" },
  { id: 2, name: "La Quinta – Mountain Course", day: "Day 3 AM", format: "2v2 Best Ball (Net)", type: "bestball", gameType: "bestball" },
  { id: 3, name: "La Quinta – Dunes Course",    day: "Day 3 PM", format: "2v2 Best Ball (Net)", type: "bestball", gameType: "bestball" },
  { id: 4, name: "PGA West – Stadium Course",   day: "Day 4",    format: "1v1 Singles (Net)",   type: "singles", gameType: "singles" },
];
const GAME_TYPE_LABELS = { bestball: "Best Ball (Net)", singles: "Singles (Net)", matchplay: "Match Play" };

const DEFAULT_RULES = [
  "Rounds 1–3: 2v2 Best Ball (Net) — 3 matches per round, 1 point each",
  "Round 4: 1v1 Singles Match Play (Net) — 6 matches, 1 point each",
  "Halved matches = ½ point to each team",
  "8 points wins the Ryder Cup (15 total available)",
];

// ─── Style helpers ────────────────────────────────────────────────────────────
const gold = "#C9A84C";
const BG = "linear-gradient(135deg,#0f2617 0%,#1a3d24 50%,#0f2617 100%)";
const CARD = { background:"rgba(0,0,0,0.25)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, padding:18, marginBottom:14 };
const SH = { fontSize:11, color:gold, letterSpacing:3, marginBottom:14, fontWeight:"bold", display:"block" };
const LBL = { fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:2, display:"block", marginBottom:5 };
const IS = (accent="rgba(255,255,255,0.15)") => ({ background:"rgba(0,0,0,0.3)", border:`1px solid ${accent}`, borderRadius:7, color:"#fff", padding:"9px 12px", fontSize:14, fontFamily:"Georgia,serif", width:"100%", boxSizing:"border-box", outline:"none" });
const BTN = (bg, fg="#fff") => ({ background:bg, color:fg, border:"none", borderRadius:8, padding:"10px 18px", fontFamily:"Georgia,serif", fontSize:13, cursor:"pointer", fontWeight:"bold" });

// ─── Data helpers ─────────────────────────────────────────────────────────────
function mkPlayer(name) { return { name, handicap:"" }; }
function initMatches() {
  return {
    1:[{result:null},{result:null},{result:null}],
    2:[{result:null},{result:null},{result:null}],
    3:[{result:null},{result:null},{result:null}],
    4:[{result:null},{result:null},{result:null},{result:null},{result:null},{result:null}],
  };
}
function initPairings() {
  return {
    1:[{t1:[0,1],t2:[0,1]},{t1:[2,3],t2:[2,3]},{t1:[4,5],t2:[4,5]}],
    2:[{t1:[0,1],t2:[0,1]},{t1:[2,3],t2:[2,3]},{t1:[4,5],t2:[4,5]}],
    3:[{t1:[0,1],t2:[0,1]},{t1:[2,3],t2:[2,3]},{t1:[4,5],t2:[4,5]}],
    4:[{t1:[0],t2:[0]},{t1:[1],t2:[1]},{t1:[2],t2:[2]},{t1:[3],t2:[3]},{t1:[4],t2:[4]},{t1:[5],t2:[5]}],
  };
}
function calcPoints(matches) {
  let t1=0, t2=0;
  Object.values(matches).flat().forEach(m => {
    if (m.result==="team1") t1++;
    else if (m.result==="team2") t2++;
    else if (m.result==="half") { t1+=0.5; t2+=0.5; }
  });
  return {team1:t1, team2:t2};
}
function calcSettlement(bets, names) {
  const bal = {};
  names.forEach(n => { bal[n]=0; });
  bets.forEach(bet => {
    const amt = parseFloat(bet.amount)||0;
    if (amt<=0||!bet.participants?.length) return;
    const W = bet.participants.filter(p=>p.side==="winner");
    const L = bet.participants.filter(p=>p.side==="loser");
    if (!W.length||!L.length) return;
    const pw = (L.length*amt)/W.length;
    W.forEach(w => { if(bal[w.name]!==undefined) bal[w.name]+=pw; });
    L.forEach(l => { if(bal[l.name]!==undefined) bal[l.name]-=amt; });
  });
  const pos = Object.entries(bal).filter(([,v])=>v>0.01).map(([n,v])=>({name:n,amt:v}));
  const neg = Object.entries(bal).filter(([,v])=>v<-0.01).map(([n,v])=>({name:n,amt:-v}));
  const txns = [];
  let pi=0,ni=0;
  while(pi<pos.length&&ni<neg.length){
    const pay=Math.min(pos[pi].amt,neg[ni].amt);
    txns.push({from:neg[ni].name,to:pos[pi].name,amount:pay.toFixed(2)});
    pos[pi].amt-=pay; neg[ni].amt-=pay;
    if(pos[pi].amt<0.01)pi++;
    if(neg[ni].amt<0.01)ni++;
  }
  return {balances:bal, transactions:txns};
}

function autoCalcMatch(courseId, matchIdx, pairings, players, roundScores, gameType) {
  if (gameType === "matchplay") return null; // Match play results are set directly via hole-by-hole entry
  const pair = pairings[courseId]?.[matchIdx];
  if (!pair) return null;
  const getNet = (teamKey, pIdx) => {
    const p = players[teamKey]?.[pIdx];
    if (!p) return null;
    const gross = getGross(roundScores?.[p.name]?.[courseId]);
    if (gross === null) return null;
    return gross - (parseInt(p.handicap) || 0);
  };
  const t1nets = pair.t1.map(i => getNet("team1", i)).filter(v => v !== null);
  const t2nets = pair.t2.map(i => getNet("team2", i)).filter(v => v !== null);
  if (!t1nets.length || !t2nets.length) return null;
  const b1 = Math.min(...t1nets), b2 = Math.min(...t2nets);
  return b1 < b2 ? "team1" : b2 < b1 ? "team2" : "half";
}

// Returns gross total from a score that may be a string (legacy), {front9,back9}, or {holes[]} object
function getGross(score) {
  if (score === null || score === undefined || score === "") return null;
  if (typeof score === "object") {
    if (score.holes?.length === 18) {
      const vals = score.holes.map(h => parseInt(h)).filter(v => !isNaN(v));
      if (vals.length === 18) return vals.reduce((s, v) => s + v, 0);
    }
    const f = parseInt(score.front9), b = parseInt(score.back9);
    if (!isNaN(f) && !isNaN(b)) return f + b;
    return null;
  }
  const n = parseInt(score);
  return isNaN(n) ? null : n;
}

// Merge static COURSES structure with editable courseList from state
function getMergedCourses(courseList) {
  if (!courseList?.length) return COURSES;
  return COURSES.map(c => {
    const cl = courseList.find(x => x.id === c.id);
    return cl ? { ...c, name: cl.name, day: cl.day, gameType: cl.gameType || c.gameType } : c;
  });
}

const DEFAULT_STATE = {
  teamNames: {team1:"TEAM 1", team2:"TEAM 2"},
  players: { team1:[1,2,3,4,5,6].map(n=>mkPlayer(`Player ${n}`)), team2:[7,8,9,10,11,12].map(n=>mkPlayer(`Player ${n}`)), pool:[] },
  matches: initMatches(),
  pairings: initPairings(),
  rules: DEFAULT_RULES,
  courseList: COURSES.map(c=>({id:c.id,name:c.name,day:c.day,gameType:c.gameType})),
  bets: [],
  roundScores: {},
};

// ═══════════════════════════════════════════════════════════════════════════════
// PLAYER PICKER
// ═══════════════════════════════════════════════════════════════════════════════
function PlayerPicker({players, teamNames, onSelect}) {
  return (
    <div style={{minHeight:"100vh",background:BG,fontFamily:"Georgia,serif",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{fontSize:32,marginBottom:6}}>🏆</div>
      <div style={{fontSize:22,color:gold,fontWeight:"bold",letterSpacing:3,marginBottom:4,textAlign:"center"}}>PALM SPRINGS</div>
      <div style={{fontSize:12,color:"rgba(255,255,255,0.35)",letterSpacing:4,marginBottom:36,textAlign:"center"}}>RYDER CUP</div>
      <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",letterSpacing:3,marginBottom:20,textAlign:"center"}}>SELECT YOUR PLAYER</div>
      <div style={{width:"100%",maxWidth:420}}>
        {["team1","team2"].map(team=>(
          <div key={team} style={{marginBottom:22}}>
            <div style={{fontSize:10,color:team==="team1"?"#4ade80":"#f87171",letterSpacing:3,marginBottom:10,textAlign:"center"}}>{teamNames[team]}</div>
            {players[team].map((p,i)=>(
              <button key={i} onClick={()=>onSelect(p.name)} style={{
                ...BTN("rgba(0,0,0,0.35)"),width:"100%",marginBottom:8,padding:"13px 18px",
                border:`1px solid ${team==="team1"?"rgba(74,222,128,0.2)":"rgba(248,113,113,0.2)"}`,
                display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:15,
              }}>
                <span>{p.name}</span>
                {p.handicap&&<span style={{fontSize:12,color:gold}}>HCP {p.handicap}</span>}
              </button>
            ))}
          </div>
        ))}
        <div style={{borderTop:"1px solid rgba(255,255,255,0.1)",paddingTop:16,marginTop:4}}>
          <button onClick={()=>onSelect("__captain__")} style={{...BTN("rgba(201,168,76,0.12)"),width:"100%",padding:13,border:`1px solid ${gold}`,color:gold,fontSize:14}}>
            ⚙️ Captain / Admin View
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAYER VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function PlayerView({playerName, state, setState, onSwitch}) {
  const {teamNames,players,matches,pairings} = state;
  const courses = getMergedCourses(state.courseList);
  const [tab,setTab] = useState("board");

  const myTeam = players.team1.find(p=>p.name===playerName)?"team1":"team2";
  const myIdx  = players[myTeam].findIndex(p=>p.name===playerName);
  const myPlayer = players[myTeam][myIdx];
  const allNames = [...players.team1,...players.team2].map(p=>p.name);
  const pts = calcPoints(matches);

  function getMyMatches() {
    const res=[];
    courses.forEach(course=>{
      pairings[course.id]?.forEach((pair,mi)=>{
        const inT1=myTeam==="team1"&&pair.t1.includes(myIdx);
        const inT2=myTeam==="team2"&&pair.t2.includes(myIdx);
        if(inT1||inT2) res.push({course,mi,pair,result:matches[course.id]?.[mi]?.result});
      });
    });
    return res;
  }

  const TABS=[{id:"board",l:"🏆 Board"},{id:"scores",l:"⛳ Scores"},{id:"matches",l:"🏌️ My Matches"},{id:"bets",l:"💰 Bets"}];
  const [openMatch, setOpenMatch] = useState(null); // {course, mi, pair}

  return (
    <div style={{minHeight:"100vh",background:BG,fontFamily:"Georgia,serif",color:"#fff"}}>
      {/* Header */}
      <div style={{background:"rgba(0,0,0,0.45)",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid rgba(201,168,76,0.25)`}}>
        <div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",letterSpacing:2}}>PLAYING AS</div>
          <div style={{fontSize:18,color:gold,fontWeight:"bold"}}>{playerName}</div>
          <div style={{fontSize:11,color:myTeam==="team1"?"#4ade80":"#f87171"}}>{teamNames[myTeam]}{myPlayer?.handicap?` · HCP ${myPlayer.handicap}`:""}</div>
        </div>
        <button onClick={onSwitch} style={{...BTN("rgba(255,255,255,0.08)"),fontSize:11,padding:"7px 14px"}}>Switch</button>
      </div>
      {/* Tabs */}
      <div style={{display:"flex",borderBottom:"1px solid rgba(255,255,255,0.1)",background:"rgba(0,0,0,0.3)",overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>{setTab(t.id);if(t.id!=="matches")setOpenMatch(null);}} style={{flex:1,padding:"12px 4px",border:"none",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:10,whiteSpace:"nowrap",background:"transparent",color:tab===t.id?gold:"rgba(255,255,255,0.4)",borderBottom:tab===t.id?`2px solid ${gold}`:"2px solid transparent"}}>{t.l}</button>
        ))}
      </div>
      <div style={{padding:16,maxWidth:600,margin:"0 auto"}}>

        {/* SCORES */}
        {tab==="scores"&&<ScoresTab playerName={playerName} myPlayer={myPlayer} myTeam={myTeam} myIdx={myIdx} state={state}/>}

        {/* MY MATCHES */}
        {tab==="matches"&&!openMatch&&(
          <div>
            <span style={SH}>MY MATCH RESULTS</span>
            {getMyMatches().length===0&&<div style={{color:"rgba(255,255,255,0.4)",fontSize:13}}>No matches assigned yet.</div>}
            {getMyMatches().map(({course,mi,pair,result},i)=>{
              const t1n=pair.t1.map(j=>players.team1[j]?.name).filter(Boolean).join(" & ");
              const t2n=pair.t2.map(j=>players.team2[j]?.name).filter(Boolean).join(" & ");
              const myNames=myTeam==="team1"?t1n:t2n;
              const oppNames=myTeam==="team1"?t2n:t1n;
              const won=(result==="team1"&&myTeam==="team1")||(result==="team2"&&myTeam==="team2");
              const lost=(result==="team1"&&myTeam==="team2")||(result==="team2"&&myTeam==="team1");
              const halved=result==="half";
              const isMatchPlay=course.gameType==="matchplay";
              const holes=matches[course.id]?.[mi]?.holes||[];
              const t1h=holes.filter(h=>h==="team1").length;
              const t2h=holes.filter(h=>h==="team2").length;
              const played=holes.filter(h=>h!==null).length;
              return (
                <div key={i} onClick={()=>setOpenMatch({course,mi,pair,t1n,t2n})}
                  style={{...CARD,borderLeft:`3px solid ${won?"#4ade80":lost?"#f87171":halved?gold:"rgba(255,255,255,0.1)"}`,cursor:"pointer",transition:"background 0.15s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.07)"}
                  onMouseLeave={e=>e.currentTarget.style.background=CARD.background||"rgba(255,255,255,0.04)"}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                    <div style={{fontSize:10,color:gold,letterSpacing:2}}>{course.day} — {course.name}</div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      {isMatchPlay&&<span style={{fontSize:9,background:"rgba(201,168,76,0.15)",border:`1px solid rgba(201,168,76,0.3)`,borderRadius:10,padding:"2px 8px",color:gold,letterSpacing:1}}>MATCH PLAY</span>}
                      <span style={{color:"rgba(255,255,255,0.3)",fontSize:16}}>›</span>
                    </div>
                  </div>
                  <div style={{fontSize:13,marginBottom:10}}>
                    <span style={{color:"#4ade80"}}>{myNames}</span>
                    <span style={{color:"rgba(255,255,255,0.3)",margin:"0 8px"}}>vs</span>
                    <span style={{color:"#f87171"}}>{oppNames}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{fontSize:20,fontWeight:"bold",color:won?"#4ade80":lost?"#f87171":halved?gold:"rgba(255,255,255,0.3)"}}>
                      {won?"✓ WIN":lost?"✕ LOSS":halved?"½ HALVED":"⏳ Pending"}
                    </div>
                    {isMatchPlay&&played>0&&(
                      <div style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>
                        <span style={{color:"#4ade80"}}>{t1h}</span>
                        <span style={{color:"rgba(255,255,255,0.2)"}}> – </span>
                        <span style={{color:"#f87171"}}>{t2h}</span>
                        <span style={{color:"rgba(255,255,255,0.25)",fontSize:10}}> ({played} holes)</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* MATCH SCORECARD DETAIL */}
        {tab==="matches"&&openMatch&&(()=>{
          const {course,mi,pair,t1n,t2n}=openMatch;
          const result=matches[course.id]?.[mi]?.result;
          const myNames=myTeam==="team1"?t1n:t2n;
          const oppNames=myTeam==="team1"?t2n:t1n;
          const won=(result==="team1"&&myTeam==="team1")||(result==="team2"&&myTeam==="team2");
          const lost=(result==="team1"&&myTeam==="team2")||(result==="team2"&&myTeam==="team1");
          const halved=result==="half";
          return (
            <div>
              <button onClick={()=>setOpenMatch(null)} style={{...BTN("rgba(255,255,255,0.08)"),fontSize:12,padding:"7px 14px",marginBottom:14}}>← Back</button>
              <div style={{...CARD,borderLeft:`3px solid ${won?"#4ade80":lost?"#f87171":halved?gold:"rgba(255,255,255,0.1)"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                  <div style={{fontSize:10,color:gold,letterSpacing:2}}>{course.day} — {course.name}</div>
                  <span style={{fontSize:9,background:"rgba(201,168,76,0.15)",border:`1px solid rgba(201,168,76,0.3)`,borderRadius:10,padding:"2px 8px",color:gold,letterSpacing:1}}>MATCH PLAY</span>
                </div>
                <div style={{fontSize:13,marginBottom:8}}>
                  <span style={{color:"#4ade80"}}>{myNames}</span>
                  <span style={{color:"rgba(255,255,255,0.3)",margin:"0 8px"}}>vs</span>
                  <span style={{color:"#f87171"}}>{oppNames}</span>
                </div>
                <div style={{fontSize:18,fontWeight:"bold",marginBottom:4,color:won?"#4ade80":lost?"#f87171":halved?gold:"rgba(255,255,255,0.3)"}}>
                  {won?"✓ WIN":lost?"✕ LOSS":halved?"½ HALVED":"⏳ Pending"}
                </div>
              </div>
              <HoleScoringSection
                courseId={course.id}
                matchIdx={mi}
                matches={matches}
                teamNames={teamNames}
                state={state}
              />
            </div>
          );
        })()}

        {/* BOARD */}
        {tab==="board"&&(
          <div>
            <span style={SH}>SCOREBOARD</span>
            <div style={{...CARD,textAlign:"center"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                <div><div style={{fontSize:30,color:"#4ade80",fontWeight:"bold"}}>{pts.team1}</div><div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{teamNames.team1}</div></div>
                <div style={{color:"rgba(255,255,255,0.3)",fontSize:12,alignSelf:"center"}}>of 15 pts</div>
                <div><div style={{fontSize:30,color:"#f87171",fontWeight:"bold"}}>{pts.team2}</div><div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{teamNames.team2}</div></div>
              </div>
              <div style={{display:"flex",height:10,borderRadius:5,overflow:"hidden",background:"rgba(255,255,255,0.1)"}}>
                <div style={{width:`${(pts.team1/15)*100}%`,background:"#4ade80",transition:"width 0.5s"}}/>
                <div style={{width:`${(pts.team2/15)*100}%`,background:"#f87171",transition:"width 0.5s"}}/>
              </div>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",marginTop:6}}>First to 8 points wins</div>
            </div>
            {courses.map(course=>{
              const rm=matches[course.id]||[];
              let r1=0,r2=0;
              rm.forEach(m=>{if(m.result==="team1")r1++;else if(m.result==="team2")r2++;else if(m.result==="half"){r1+=0.5;r2+=0.5;}});
              return (
                <div key={course.id} style={{...CARD,padding:"12px 16px"}}>
                  <div style={{fontSize:10,color:gold,letterSpacing:2,marginBottom:4}}>{course.day}</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{fontSize:12,color:"rgba(255,255,255,0.7)"}}>{course.name}</div>
                    <div style={{fontSize:16,fontWeight:"bold"}}><span style={{color:"#4ade80"}}>{r1}</span><span style={{color:"rgba(255,255,255,0.25)",margin:"0 6px"}}>–</span><span style={{color:"#f87171"}}>{r2}</span></div>
                  </div>
                </div>
              );
            })}
            <LiveScoresSection courses={courses} players={players} roundScores={state.roundScores} teamNames={teamNames}/>
          </div>
        )}

        {/* BETS */}
        {tab==="bets"&&(
          <PlayerBetsTab
            playerName={playerName}
            allNames={allNames}
            state={state}
            setState={setState}
          />
        )}
      </div>
    </div>
  );
}

// ─── Player Bets Tab ─────────────────────────────────────────────────────────
function PlayerBetsTab({ playerName, allNames, state, setState }) {
  const { bets, courseList } = state;
  const [showAdd, setShowAdd] = useState(false);
  const [editingBet, setEditingBet] = useState(null);
  const [saving, setSaving] = useState(false);
  const [betName, setBetName] = useState("");
  const [betAmt, setBetAmt] = useState("");
  const [betCourse, setBetCourse] = useState("");
  const [picked, setPicked] = useState([]);

  const otherPlayers = allNames.filter(n => n !== playerName);
  const myBets = (bets || []).filter(b => b.participants?.some(p => p.name === playerName));

  const { balances, transactions } = calcSettlement(bets || [], allNames);
  const myBal = balances[playerName] || 0;
  const myTxns = transactions.filter(t => t.from === playerName || t.to === playerName);

  function togglePick(name) {
    setPicked(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  }

  function openNew() {
    setEditingBet(null);
    setBetName(""); setBetAmt(""); setBetCourse(""); setPicked([]);
    setShowAdd(true);
  }

  function openEdit(bet) {
    setEditingBet(bet);
    setBetName(bet.name);
    setBetAmt(bet.amount);
    setBetCourse(bet.course || "");
    setPicked(bet.participants.filter(p => p.name !== playerName).map(p => p.name));
    setShowAdd(true);
  }

  function resetForm() {
    setBetName(""); setBetAmt(""); setBetCourse(""); setPicked([]);
    setShowAdd(false); setEditingBet(null);
  }

  // Read-then-merge to avoid overwriting concurrent changes
  async function writeBets(newBets) {
    setState(prev => ({ ...prev, bets: newBets }));
    try {
      const cur = (await storageGet()) || { ...DEFAULT_STATE };
      cur.bets = newBets;
      await storageSet(cur);
    } catch(e) { console.error("writeBets error:", e); }
  }

  function saveBet() {
    if (!betName.trim() || !betAmt || picked.length === 0) return;
    setSaving(true);

    if (editingBet) {
      const existingByName = Object.fromEntries(editingBet.participants.map(p => [p.name, p]));
      const participants = [
        existingByName[playerName] || { name: playerName, side: "pending" },
        ...picked.map(n => existingByName[n] || { name: n, side: "pending" }),
      ];
      const updated = { ...editingBet, name: betName.trim(), amount: betAmt, course: betCourse, participants };
      const newBets = (bets || []).map(b => b.id === editingBet.id ? updated : b);
      writeBets(newBets).finally(() => { setSaving(false); resetForm(); });
    } else {
      const participants = [
        { name: playerName, side: "pending" },
        ...picked.map(n => ({ name: n, side: "pending" })),
      ];
      const newBet = { id: Date.now(), name: betName.trim(), amount: betAmt, course: betCourse, createdBy: playerName, participants };
      writeBets([...(bets || []), newBet]).finally(() => { setSaving(false); resetForm(); });
    }
  }

  function markResult(betId, side) {
    const newBets = (bets || []).map(b => {
      if (b.id !== betId) return b;
      return { ...b, participants: b.participants.map(p => p.name === playerName ? { ...p, side } : p) };
    });
    writeBets(newBets);
  }

  function deleteBet(betId) {
    writeBets((bets || []).filter(b => b.id !== betId));
  }

  const canSave = betName.trim() && betAmt && picked.length > 0;

  return (
    <div>
      {/* Balance + new bet button */}
      <div style={{ display:"flex", gap:10, marginBottom:16, alignItems:"stretch" }}>
        <div style={{ ...CARD, flex:1, marginBottom:0, textAlign:"center", padding:"14px 8px" }}>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:2, marginBottom:6 }}>MY NET</div>
          <div style={{ fontSize:26, fontWeight:"bold", color:myBal>=0?"#4ade80":"#f87171" }}>
            {myBal>=0?"+":""}${myBal.toFixed(2)}
          </div>
        </div>
        <button onClick={openNew} style={{ ...BTN(gold, "#1a3d24"), minWidth:90, fontSize:13, borderRadius:12 }}>
          + New<br/>Bet
        </button>
      </div>

      {/* Settlement */}
      {myTxns.length > 0 && (
        <div style={{ ...CARD, background:"rgba(201,168,76,0.07)", border:"1px solid rgba(201,168,76,0.2)", marginBottom:16 }}>
          <span style={SH}>💵 SETTLEMENT</span>
          {myTxns.map((t, i) => (
            <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
              {t.from === playerName
                ? <span style={{ fontSize:13 }}>You owe <span style={{ color:gold }}>{t.to}</span></span>
                : <span style={{ fontSize:13 }}><span style={{ color:gold }}>{t.from}</span> owes you</span>}
              <span style={{ fontWeight:"bold", color:t.from===playerName?"#f87171":"#4ade80" }}>
                {t.from===playerName?"–":"+"}${t.amount}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Bet list */}
      <span style={SH}>MY BETS ({myBets.length})</span>
      {myBets.length === 0 && (
        <div style={{ color:"rgba(255,255,255,0.3)", fontSize:13, textAlign:"center", padding:"28px 0" }}>
          No bets yet — tap + New Bet to start one.
        </div>
      )}
      {myBets.map(bet => {
        const me = bet.participants.find(p => p.name === playerName);
        const isMine = bet.createdBy === playerName;
        return (
          <div key={bet.id} style={{ ...CARD, borderLeft:`3px solid ${me?.side==="winner"?"#4ade80":me?.side==="loser"?"#f87171":"rgba(201,168,76,0.4)"}` }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
              <div style={{ fontSize:14, fontWeight:"bold" }}>{bet.name}</div>
              <div style={{ fontSize:13, color:gold, fontWeight:"bold" }}>${bet.amount}/pp</div>
            </div>
            {bet.course && <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginBottom:8 }}>{bet.course}</div>}
            <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:12 }}>
              {bet.participants.map(p => (
                <span key={p.name} style={{ fontSize:11, padding:"3px 9px", borderRadius:20, background:p.side==="winner"?"rgba(74,222,128,0.15)":p.side==="loser"?"rgba(248,113,113,0.1)":"rgba(255,255,255,0.07)", border:`1px solid ${p.side==="winner"?"rgba(74,222,128,0.4)":p.side==="loser"?"rgba(248,113,113,0.3)":"rgba(255,255,255,0.12)"}`, color:p.side==="winner"?"#4ade80":p.side==="loser"?"#f87171":"rgba(255,255,255,0.55)" }}>
                  {p.name === playerName ? "You" : p.name}{p.side==="winner"?" ✓":p.side==="loser"?" ✕":""}
                </span>
              ))}
            </div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", letterSpacing:2, marginBottom:6 }}>YOUR RESULT</div>
            <div style={{ display:"flex", gap:6, marginBottom:8 }}>
              {[{s:"winner",l:"✓ I Won",bg:"#1A5C38",on:"#2d8a56"},{s:"loser",l:"✕ I Lost",bg:"#7a1a1a",on:"#cc4444"},{s:"pending",l:"Pending",bg:"rgba(255,255,255,0.06)",on:"rgba(255,255,255,0.18)"}].map(btn => (
                <button key={btn.s} onClick={() => markResult(bet.id, btn.s)} style={{ flex:1, padding:"9px 2px", border:"none", borderRadius:7, cursor:"pointer", fontFamily:"Georgia,serif", fontSize:11, background:me?.side===btn.s?btn.on:btn.bg, color:"#fff", fontWeight:me?.side===btn.s?"bold":"normal" }}>
                  {btn.l}
                </button>
              ))}
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={() => openEdit(bet)} style={{ flex:1, padding:"6px", background:"rgba(201,168,76,0.1)", border:`1px solid rgba(201,168,76,0.3)`, color:gold, borderRadius:6, cursor:"pointer", fontFamily:"Georgia,serif", fontSize:11 }}>
                ✎ Edit Bet
              </button>
              {isMine && (
                <button onClick={() => deleteBet(bet.id)} style={{ flex:1, padding:"6px", background:"transparent", border:"1px solid rgba(255,255,255,0.08)", color:"rgba(255,255,255,0.25)", borderRadius:6, cursor:"pointer", fontFamily:"Georgia,serif", fontSize:11 }}>
                  Delete
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* New bet sheet */}
      {showAdd && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.88)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:300 }}>
          <div style={{ background:"#152e1d", border:`1px solid ${gold}`, borderRadius:"16px 16px 0 0", padding:24, width:"100%", maxWidth:500, maxHeight:"88vh", overflowY:"auto" }}>
            <div style={{ fontSize:15, fontWeight:"bold", color:gold, marginBottom:18 }}>{editingBet ? "EDIT BET" : "NEW SIDE BET"}</div>

            <div style={{ marginBottom:14 }}>
              <label style={LBL}>BET NAME</label>
              <input value={betName} onChange={e => setBetName(e.target.value)} placeholder='e.g. Closest to pin #7' autoFocus style={{ ...IS(), fontSize:14 }} />
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={LBL}>$ PER PERSON</label>
              <input type="number" value={betAmt} onChange={e => setBetAmt(e.target.value)} placeholder="20" style={{ ...IS(gold), fontSize:22, fontWeight:"bold", textAlign:"center", color:gold }} />
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={LBL}>COURSE (OPTIONAL)</label>
              <select value={betCourse} onChange={e => setBetCourse(e.target.value)} style={{ ...IS(), cursor:"pointer" }}>
                <option value="">— All Rounds —</option>
                {(courseList || []).map((c, i) => <option key={i} value={c.name}>{c.day} — {c.name}</option>)}
              </select>
            </div>

            <div style={{ marginBottom:22 }}>
              <label style={LBL}>BETTING AGAINST</label>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {otherPlayers.map(name => {
                  const on = picked.includes(name);
                  return (
                    <button key={name} onClick={() => togglePick(name)} style={{ padding:"8px 14px", borderRadius:20, border:`1px solid ${on?gold:"rgba(255,255,255,0.12)"}`, background:on?"rgba(201,168,76,0.2)":"rgba(255,255,255,0.05)", color:on?gold:"rgba(255,255,255,0.5)", cursor:"pointer", fontFamily:"Georgia,serif", fontSize:13 }}>
                      {on ? "✓ " : ""}{name}
                    </button>
                  );
                })}
              </div>
              {picked.length > 0 && betAmt && (
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginTop:8 }}>
                  Pot: ${((picked.length + 1) * (parseFloat(betAmt) || 0)).toFixed(2)} total · {picked.length + 1} players
                </div>
              )}
            </div>

            <div style={{ display:"flex", gap:10 }}>
              <button onClick={saveBet} disabled={saving || !canSave} style={{ ...BTN(canSave ? gold : "rgba(201,168,76,0.2)", canSave ? "#1a3d24" : "rgba(255,255,255,0.3)"), flex:1, padding:14, fontSize:15 }}>
                {saving ? "Saving..." : editingBet ? "Save Changes" : "Create Bet"}
              </button>
              <button onClick={resetForm} style={{ ...BTN("rgba(255,255,255,0.07)"), padding:"14px 20px", color:"rgba(255,255,255,0.4)" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Scores Tab ───────────────────────────────────────────────────────────────
function ScoresTab({playerName, myPlayer, myTeam, myIdx, state}) {
  const {pairings, players, roundScores} = state;
  const courses = getMergedCourses(state.courseList);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  function initLocal() {
    const out = {};
    COURSES.forEach(c => {
      const s = roundScores?.[playerName]?.[c.id];
      out[c.id] = (s && typeof s === "object")
        ? { front9: s.front9 ?? "", back9: s.back9 ?? "" }
        : { front9: "", back9: "" };
    });
    return out;
  }

  const [localScores, setLocalScores] = useState(initLocal);

  useEffect(() => { setLocalScores(initLocal()); }, [playerName, roundScores]);

  function setHalf(courseId, half, val) {
    if (val === "" || /^\d{0,2}$/.test(val)) {
      setLocalScores(prev => ({ ...prev, [courseId]: { ...prev[courseId], [half]: val } }));
      setSaved(false);
    }
  }

  function blurHalf(courseId, half, val) {
    const n = parseInt(val);
    const next = !isNaN(n) ? String(Math.max(9, Math.min(99, n))) : "";
    setLocalScores(prev => ({ ...prev, [courseId]: { ...prev[courseId], [half]: next } }));
  }

  async function save() {
    setSaving(true);
    try {
      const cur = (await storageGet()) || { ...DEFAULT_STATE };
      if (!cur.roundScores) cur.roundScores = {};
      if (!cur.roundScores[playerName]) cur.roundScores[playerName] = {};
      COURSES.forEach(c => { cur.roundScores[playerName][c.id] = localScores[c.id]; });
      COURSES.forEach(c => {
        const gt = (cur.courseList || state.courseList)?.find(cl => cl.id === c.id)?.gameType || c.gameType;
        (cur.pairings || pairings)[c.id]?.forEach((pair, mi) => {
          const inT1 = myTeam === "team1" && pair.t1.includes(myIdx);
          const inT2 = myTeam === "team2" && pair.t2.includes(myIdx);
          if (inT1 || inT2) {
            const auto = autoCalcMatch(c.id, mi, cur.pairings || pairings, cur.players || players, cur.roundScores, gt);
            if (auto) {
              if (!cur.matches) cur.matches = initMatches();
              if (cur.matches[c.id]?.[mi]) cur.matches[c.id][mi].result = auto;
            }
          }
        });
      });
      await storageSet(cur);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch(e) { console.error("save error:", e); }
    setSaving(false);
  }

  const hdcp = parseInt(myPlayer?.handicap) || 0;

  return (
    <div>
      <span style={SH}>MY ROUND SCORES</span>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", marginBottom:20 }}>
        Enter front 9 and back 9 scores. Others can see your progress live.
      </div>

      {courses.map(c => {
        const sc = localScores[c.id];
        const f = parseInt(sc.front9), b = parseInt(sc.back9);
        const hasF = !isNaN(f), hasB = !isNaN(b);
        const total = (hasF && hasB) ? f + b : null;
        const net = total !== null ? total - hdcp : null;
        return (
          <div key={c.id} style={{ ...CARD, marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div>
                <div style={{ fontSize:10, color:gold, letterSpacing:2, marginBottom:3 }}>{c.day}</div>
                <div style={{ fontSize:13, color:"rgba(255,255,255,0.7)" }}>{c.name}</div>
              </div>
              {total !== null ? (
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", marginBottom:2 }}>TOTAL · NET</div>
                  <div style={{ fontSize:20, fontWeight:"bold", color:gold }}>{total} · {net}</div>
                </div>
              ) : hasF ? (
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", marginBottom:2 }}>THRU 9</div>
                  <div style={{ fontSize:20, fontWeight:"bold", color:"rgba(255,255,255,0.55)" }}>{f}</div>
                </div>
              ) : null}
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", letterSpacing:2, marginBottom:6 }}>FRONT 9</div>
                <input
                  type="text" inputMode="numeric"
                  value={sc.front9}
                  onChange={e => setHalf(c.id, "front9", e.target.value)}
                  onBlur={e => blurHalf(c.id, "front9", e.target.value)}
                  placeholder="—"
                  style={{ ...IS(hasF ? gold : "rgba(255,255,255,0.12)"), fontSize:26, fontWeight:"bold", textAlign:"center", color: hasF ? gold : "rgba(255,255,255,0.3)", padding:"12px 8px" }}
                />
              </div>
              <div style={{ fontSize:20, color:"rgba(255,255,255,0.2)", paddingBottom:14 }}>+</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", letterSpacing:2, marginBottom:6 }}>BACK 9</div>
                <input
                  type="text" inputMode="numeric"
                  value={sc.back9}
                  onChange={e => setHalf(c.id, "back9", e.target.value)}
                  onBlur={e => blurHalf(c.id, "back9", e.target.value)}
                  placeholder="—"
                  style={{ ...IS(hasB ? gold : "rgba(255,255,255,0.12)"), fontSize:26, fontWeight:"bold", textAlign:"center", color: hasB ? gold : "rgba(255,255,255,0.3)", padding:"12px 8px" }}
                />
              </div>
              <div style={{ textAlign:"center", paddingBottom:6 }}>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", letterSpacing:2, marginBottom:4 }}>HCP</div>
                <div style={{ fontSize:18, fontWeight:"bold", color:"rgba(255,255,255,0.4)" }}>{hdcp || "—"}</div>
              </div>
            </div>
          </div>
        );
      })}

      <button onClick={save} disabled={saving} style={{ ...BTN(saved ? "#2d8a56" : gold, "#1a3d24"), width:"100%", padding:14, fontSize:15, marginTop:4 }}>
        {saving ? "Saving..." : saved ? "✓ Saved!" : "Save Scores"}
      </button>
    </div>
  );
}

// ─── Live Scores Section ──────────────────────────────────────────────────────
function LiveScoresSection({courses, players, roundScores, teamNames}) {
  const hasAny = Object.values(roundScores||{}).some(r =>
    Object.values(r||{}).some(s => s && (typeof s === "object" ? (s.front9||s.back9) : true))
  );
  if (!hasAny) return null;
  return (
    <>
      <span style={{...SH, marginTop:20}}>LIVE SCORES</span>
      {courses.map(course => {
        const rows = ["team1","team2"].flatMap(team =>
          players[team].map((p,i) => {
            const s = roundScores?.[p.name]?.[course.id];
            if (!s) return null;
            const front9 = typeof s === "object" ? (s.front9||"") : "";
            const back9  = typeof s === "object" ? (s.back9||"")  : "";
            const total  = getGross(s);
            const hdcp   = parseInt(p.handicap)||0;
            const net    = total !== null ? total - hdcp : null;
            if (!front9 && !back9 && total === null) return null;
            return { name:p.name, team, front9, back9, total, net };
          }).filter(Boolean)
        );
        if (!rows.length) return null;
        return (
          <div key={course.id} style={{...CARD, marginBottom:10, padding:"12px 14px"}}>
            <div style={{fontSize:10, color:gold, letterSpacing:2, marginBottom:2}}>{course.day}</div>
            <div style={{fontSize:12, color:"rgba(255,255,255,0.5)", marginBottom:10}}>{course.name}</div>
            <div style={{display:"flex", justifyContent:"flex-end", gap:6, fontSize:9, color:"rgba(255,255,255,0.3)", letterSpacing:1, marginBottom:4}}>
              <span style={{width:30, textAlign:"center"}}>F9</span>
              <span style={{width:30, textAlign:"center"}}>B9</span>
              <span style={{width:38, textAlign:"center"}}>TOT</span>
            </div>
            {rows.map((r,i) => (
              <div key={i} style={{display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                <div>
                  <span style={{fontSize:12, color: r.team==="team1"?"#4ade80":"#f87171"}}>{r.name}</span>
                  {r.net !== null && <span style={{fontSize:10, color:"rgba(255,255,255,0.3)", marginLeft:6}}>net {r.net}</span>}
                </div>
                <div style={{display:"flex", gap:6, alignItems:"center"}}>
                  <span style={{width:30, textAlign:"center", fontSize:13, color:"rgba(255,255,255,0.65)"}}>{r.front9||"—"}</span>
                  <span style={{width:30, textAlign:"center", fontSize:13, color:"rgba(255,255,255,0.65)"}}>{r.back9||"—"}</span>
                  <span style={{width:38, textAlign:"center", fontSize:14, fontWeight:"bold", color: r.total!==null?gold:"rgba(255,255,255,0.2)"}}>{r.total!==null?r.total:"—"}</span>
                </div>
              </div>
            ))}
          </div>
        );
      }).filter(Boolean)}
    </>
  );
}

// ─── Hole-by-hole scoring (Match Play) ───────────────────────────────────────
// Each hole is marked Team 1, Team 2, or unset. Stored in matches[courseId][matchIdx].holes.
function HoleScoringSection({ courseId, matchIdx, matches, teamNames, state }) {
  function initHoles() {
    const existing = matches?.[courseId]?.[matchIdx]?.holes;
    return existing?.length === 18 ? [...existing] : Array(18).fill(null);
  }

  const [holes, setHoles] = useState(initHoles);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setHoles(initHoles()); setSaved(false); }, [matches, courseId, matchIdx]); // eslint-disable-line

  function toggleHole(idx) {
    setHoles(prev => {
      const n = [...prev];
      n[idx] = !n[idx] ? "team1" : n[idx] === "team1" ? "team2" : null;
      return n;
    });
    setSaved(false);
  }

  const t1 = holes.filter(h => h === "team1").length;
  const t2 = holes.filter(h => h === "team2").length;
  const played = holes.filter(h => h !== null).length;

  async function save() {
    setSaving(true);
    try {
      const cur = (await storageGet()) || { ...DEFAULT_STATE };
      if (!cur.matches) cur.matches = initMatches();
      if (!cur.matches[courseId]?.[matchIdx]) cur.matches[courseId][matchIdx] = { result: null };
      cur.matches[courseId][matchIdx].holes = holes;
      const t1c = holes.filter(h => h === "team1").length;
      const t2c = holes.filter(h => h === "team2").length;
      const pc  = holes.filter(h => h !== null).length;
      cur.matches[courseId][matchIdx].result = pc === 0 ? null : t1c > t2c ? "team1" : t2c > t1c ? "team2" : pc === 18 ? "half" : null;
      await storageSet(cur);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch(e) { console.error("save hole error:", e); }
    setSaving(false);
  }

  const t1Name = teamNames?.team1 || "TEAM 1";
  const t2Name = teamNames?.team2 || "TEAM 2";
  const t1c = "#4ade80", t2c = "#f87171";

  function holeBtn(h) {
    const v = holes[h];
    return (
      <button key={h} onClick={() => toggleHole(h)} style={{
        flex: 1, minWidth: 0, height: 44, border: "none", borderRadius: 6, cursor: "pointer",
        fontFamily: "Georgia,serif", fontSize: 11, fontWeight: "bold", padding: 0,
        background: v === "team1" ? "rgba(74,222,128,0.25)" : v === "team2" ? "rgba(248,113,113,0.25)" : "rgba(0,0,0,0.35)",
        color: v === "team1" ? t1c : v === "team2" ? t2c : "rgba(255,255,255,0.2)",
        outline: v ? `1px solid ${v === "team1" ? t1c : t2c}` : "1px solid rgba(255,255,255,0.07)",
      }}>
        {v === "team1" ? "T1" : v === "team2" ? "T2" : "—"}
      </button>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: gold, letterSpacing: 2, fontWeight: "bold" }}>SCORECARD</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>tap hole to cycle: T1 → T2 → clear</div>
      </div>
      {[0, 9].map(start => {
        const hs = Array.from({ length: 9 }, (_, i) => start + i);
        const sub1 = hs.filter(h => holes[h] === "team1").length;
        const sub2 = hs.filter(h => holes[h] === "team2").length;
        return (
          <div key={start} style={{ marginBottom: 14, background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "10px 10px 12px" }}>
            <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
              {hs.map(h => <div key={h} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{h + 1}</div>)}
              <div style={{ width: 38, textAlign: "center", fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: 1 }}>{start === 0 ? "OUT" : "IN"}</div>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {hs.map(h => holeBtn(h))}
              <div style={{ width: 38, textAlign: "center", fontSize: 13 }}>
                <span style={{ color: t1c, fontWeight: "bold" }}>{sub1}</span>
                <span style={{ color: "rgba(255,255,255,0.2)" }}>–</span>
                <span style={{ color: t2c, fontWeight: "bold" }}>{sub2}</span>
              </div>
            </div>
          </div>
        );
      })}
      {played > 0 && (
        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 14px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>After {played} hole{played !== 1 ? "s" : ""}</div>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: "bold", color: t1 > t2 ? t1c : t1 < t2 ? "rgba(255,255,255,0.35)" : gold }}>{t1}</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: 1, maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t1Name}</div>
            </div>
            <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 14 }}>–</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: "bold", color: t2 > t1 ? t2c : t2 < t1 ? "rgba(255,255,255,0.35)" : gold }}>{t2}</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: 1, maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t2Name}</div>
            </div>
          </div>
        </div>
      )}
      <button onClick={save} disabled={saving} style={{ ...BTN(saved ? "#2d8a56" : gold, "#1a3d24"), width: "100%", padding: 12, fontSize: 14 }}>
        {saving ? "Saving..." : saved ? "✓ Saved!" : "Save Hole Results"}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPTAIN VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function CaptainView({state, setState, onSwitch}) {
  const {teamNames,players,matches,pairings,rules,courseList,bets,roundScores} = state;
  const courses = getMergedCourses(courseList);
  const [tab,setTab]=useState("scoreboard");
  const [saveStatus,setSaveStatus]=useState("idle");
  const [editRuleIdx,setEditRuleIdx]=useState(null);
  const [editRuleTxt,setEditRuleTxt]=useState("");
  const [addPlayerModal,setAddPlayerModal]=useState(null);
  const [newPName,setNewPName]=useState("");
  const [newPHdcp,setNewPHdcp]=useState("");
  const [scanThumb,setScanThumb]=useState("");
  const [scorecardModal,setScorecardModal]=useState(null);
  const [scorecardThumb,setScorecardThumb]=useState("");
  const [scorecardStatus,setScorecardStatus]=useState("idle");
  const [scorecardMsg,setScorecardMsg]=useState("");
  const [setupDraft,setSetupDraft]=useState({teamNames,players:{...players,pool:players.pool||[]},rules,courseList});
  const [setupDirty,setSetupDirty]=useState(false);

  const pts=calcPoints(matches);
  const winner=pts.team1>=8?"team1":pts.team2>=8?"team2":null;
  const allPlayers=[...players.team1,...players.team2];
  const allNames=allPlayers.map(p=>p.name);
  const {balances,transactions}=calcSettlement(bets,allNames);

  async function persist(patch) {
    setState(prev => {
      const next = { ...prev, ...patch };
      storageSet(next)
        .then(() => { setSaveStatus("saved"); setTimeout(() => setSaveStatus("idle"), 2000); })
        .catch(() => { setSaveStatus("error"); setTimeout(() => setSaveStatus("idle"), 3000); });
      return next;
    });
  }

  // Sync setup draft from Firestore updates only when not editing
  useEffect(() => {
    if (!setupDirty) setSetupDraft({ teamNames, players: { ...players, pool: players.pool || [] }, rules, courseList });
  }, [state]); // eslint-disable-line

  function draftChange(patch) {
    setSetupDraft(prev => ({ ...prev, ...patch }));
    setSetupDirty(true);
  }

  async function saveSetup() {
    await persist(setupDraft);
    setSetupDirty(false);
  }

  function updDraftPlayer(group, idx, field, val) {
    const p = JSON.parse(JSON.stringify(setupDraft.players));
    if (!p[group]) p[group] = [];
    p[group][idx][field] = val;
    draftChange({ players: p });
  }

  function removeDraftPlayer(group, idx) {
    const p = JSON.parse(JSON.stringify(setupDraft.players));
    p[group].splice(idx, 1);
    draftChange({ players: p });
  }

  function moveDraftPlayer(fromGroup, fromIdx, toGroup) {
    if (fromGroup === toGroup) return;
    const p = JSON.parse(JSON.stringify(setupDraft.players));
    const [player] = p[fromGroup].splice(fromIdx, 1);
    if (!p[toGroup]) p[toGroup] = [];
    p[toGroup].push(player);
    draftChange({ players: p });
  }

  function setMR(rId,mi,result){
    const m=JSON.parse(JSON.stringify(matches));
    m[rId][mi].result=result;
    persist({matches:m});
  }
  function updPair(rId,mi,team,slot,idx){
    const p=JSON.parse(JSON.stringify(pairings));
    p[rId][mi][team][slot]=parseInt(idx);
    persist({pairings:p});
  }
  function updPlayer(team,idx,field,val){
    const p=JSON.parse(JSON.stringify(players));
    p[team][idx][field]=val;
    persist({players:p});
  }
  function removePlayer(team,idx){
    if(players[team].length<=1)return;
    const p=JSON.parse(JSON.stringify(players));
    p[team].splice(idx,1);
    persist({players:p});
  }
  function addPlayer(){
    if(!newPName.trim())return;
    const p=JSON.parse(JSON.stringify(setupDraft.players));
    if(!p.pool)p.pool=[];
    p.pool.push({name:newPName.trim(),handicap:newPHdcp?String(Math.round(parseFloat(newPHdcp)||0)):""});
    draftChange({players:p});
    setAddPlayerModal(null);setNewPName("");setNewPHdcp("");setScanThumb("");
  }

  async function scanCard(file,cId,mi,t1n,t2n){
    setScorecardStatus("loading");setScorecardMsg("");
    try{
      const b64=await new Promise((res,rej)=>{
        const reader=new FileReader();
        reader.onload=()=>{
          const img=new Image();
          img.onload=()=>{
            const MAX=1400,sc=Math.min(1,MAX/Math.max(img.width,img.height));
            const cv=document.createElement("canvas");
            cv.width=Math.round(img.width*sc);cv.height=Math.round(img.height*sc);
            cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
            setScorecardThumb(cv.toDataURL("image/jpeg",0.6));
            res(cv.toDataURL("image/jpeg",0.88).split(",")[1]);
          };
          img.onerror=rej;img.src=reader.result;
        };
        reader.onerror=rej;reader.readAsDataURL(file);
      });
      let resp;
      try{resp=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:120,messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:"image/jpeg",data:b64}},{type:"text",text:`Golf scorecard: "${t1n}" vs "${t2n}". Who won?\nRESULT: TEAM1_WIN or TEAM2_WIN or HALVED\nREASON: brief`}]}]})});}
      catch(e){setScorecardStatus("error");setScorecardMsg("Network blocked — use manual buttons.");return;}
      const data=JSON.parse(await resp.text());
      if(data.error){setScorecardStatus("error");setScorecardMsg(data.error.message);return;}
      const txt=data?.content?.find(b=>b.type==="text")?.text||"";
      const rm=txt.match(/RESULT:\s*(TEAM1_WIN|TEAM2_WIN|HALVED)/i);
      const reason=txt.match(/REASON:\s*(.+)/i)?.[1]||"";
      if(!rm){setScorecardStatus("error");setScorecardMsg("Couldn't read — enter manually.");return;}
      const mapped=rm[1].toUpperCase()==="TEAM1_WIN"?"team1":rm[1].toUpperCase()==="TEAM2_WIN"?"team2":"half";
      setMR(cId,mi,mapped);setScorecardStatus("done");setScorecardMsg(reason);
      setTimeout(()=>setScorecardModal(null),2200);
    }catch(e){setScorecardStatus("error");setScorecardMsg(e.message||"Error");}
  }

  const NAV=[{id:"scoreboard",l:"🏆 Board"},{id:"rounds",l:"⛳ Rounds"},{id:"pairings",l:"🤝 Pairs"},{id:"sidebets",l:"💰 Bets"},{id:"setup",l:"⚙️ Setup"}];

  return (
    <div style={{minHeight:"100vh",background:BG,fontFamily:"Georgia,serif",color:"#fff"}}>
      {/* Header */}
      <div style={{background:"rgba(0,0,0,0.5)",padding:"12px 18px",borderBottom:`1px solid rgba(201,168,76,0.25)`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:15,color:gold,fontWeight:"bold",letterSpacing:2}}>RYDER CUP</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",letterSpacing:2}}>CAPTAIN VIEW</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:10,color:saveStatus==="saved"?"#4ade80":saveStatus==="error"?"#f87171":"rgba(255,255,255,0.25)"}}>{saveStatus==="saved"?"✓ SAVED":saveStatus==="error"?"✕ ERR":"● AUTO"}</span>
          <button onClick={onSwitch} style={{...BTN("rgba(255,255,255,0.08)"),fontSize:11,padding:"6px 12px"}}>Switch</button>
        </div>
      </div>
      {/* Nav */}
      <div style={{display:"flex",borderBottom:"1px solid rgba(255,255,255,0.1)",background:"rgba(0,0,0,0.3)",overflowX:"auto"}}>
        {NAV.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:"11px 4px",border:"none",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:10,whiteSpace:"nowrap",background:"transparent",color:tab===t.id?gold:"rgba(255,255,255,0.4)",borderBottom:tab===t.id?`2px solid ${gold}`:"2px solid transparent"}}>{t.l}</button>
        ))}
      </div>

      <div style={{padding:16,maxWidth:600,margin:"0 auto"}}>

        {/* SCOREBOARD */}
        {tab==="scoreboard"&&(
          <div>
            {winner&&<div style={{background:"rgba(201,168,76,0.12)",border:`1px solid ${gold}`,borderRadius:12,padding:20,textAlign:"center",marginBottom:20}}><div style={{fontSize:24}}>🏆</div><div style={{fontSize:20,color:gold,fontWeight:"bold"}}>{teamNames[winner]} WINS!</div></div>}
            <div style={{...CARD,textAlign:"center"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                <div><div style={{fontSize:30,color:"#4ade80",fontWeight:"bold"}}>{pts.team1}</div><div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{teamNames.team1}</div></div>
                <div style={{color:"rgba(255,255,255,0.3)",fontSize:12,alignSelf:"center"}}>of 15 pts</div>
                <div><div style={{fontSize:30,color:"#f87171",fontWeight:"bold"}}>{pts.team2}</div><div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{teamNames.team2}</div></div>
              </div>
              <div style={{display:"flex",height:12,borderRadius:6,overflow:"hidden",background:"rgba(255,255,255,0.1)"}}>
                <div style={{width:`${(pts.team1/15)*100}%`,background:"#4ade80",transition:"width 0.5s"}}/>
                <div style={{width:`${(pts.team2/15)*100}%`,background:"#f87171",transition:"width 0.5s"}}/>
              </div>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",marginTop:6}}>First to 8 wins</div>
            </div>
            {allPlayers.some(p=>p.handicap)&&(
              <div style={CARD}>
                <span style={SH}>PLAYER HANDICAPS</span>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {["team1","team2"].map(team=>(
                    <div key={team}>
                      <div style={{fontSize:10,color:team==="team1"?"#4ade80":"#f87171",letterSpacing:2,marginBottom:6}}>{teamNames[team]}</div>
                      {players[team].map((p,i)=>(
                        <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                          <span style={{fontSize:12}}>{p.name}</span>
                          <span style={{fontSize:13,fontWeight:"bold",color:p.handicap?gold:"rgba(255,255,255,0.2)"}}>{p.handicap||"—"}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <span style={SH}>ROUND SUMMARY</span>
            {courses.map(course=>{
              const rm=matches[course.id]||[];
              let r1=0,r2=0;
              rm.forEach(m=>{if(m.result==="team1")r1++;else if(m.result==="team2")r2++;else if(m.result==="half"){r1+=0.5;r2+=0.5;}});
              return (
                <div key={course.id} style={CARD}>
                  <div style={{fontSize:10,color:gold,letterSpacing:2,marginBottom:4}}>{course.day}</div>
                  <div style={{fontSize:14,fontWeight:"bold",marginBottom:8}}>{course.name}</div>
                  <div style={{display:"flex",gap:6}}>
                    {rm.map((m,i)=>(
                      <div key={i} style={{flex:1,textAlign:"center",padding:"6px 2px",borderRadius:6,fontSize:11,background:m.result==="team1"?"rgba(74,222,128,0.15)":m.result==="team2"?"rgba(248,113,113,0.15)":m.result==="half"?"rgba(201,168,76,0.15)":"rgba(255,255,255,0.05)",color:m.result==="team1"?"#4ade80":m.result==="team2"?"#f87171":m.result==="half"?gold:"rgba(255,255,255,0.3)"}}>
                        M{i+1}<br/>{m.result==="team1"?"T1":m.result==="team2"?"T2":m.result==="half"?"½":"–"}
                      </div>
                    ))}
                    <div style={{alignSelf:"center",fontSize:16,fontWeight:"bold",minWidth:48,textAlign:"right"}}>
                      <span style={{color:"#4ade80"}}>{r1}</span><span style={{color:"rgba(255,255,255,0.2)",margin:"0 4px"}}>–</span><span style={{color:"#f87171"}}>{r2}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            <LiveScoresSection courses={courses} players={players} roundScores={roundScores} teamNames={teamNames}/>
          </div>
        )}

        {/* ROUNDS */}
        {tab==="rounds"&&(
          <div>
            <span style={SH}>MATCH RESULTS</span>
            {courses.map(course=>(
              <div key={course.id} style={CARD}>
                <div style={{fontSize:10,color:gold,letterSpacing:3}}>{course.day} — ROUND {course.id}</div>
                <div style={{fontSize:15,fontWeight:"bold",margin:"4px 0 4px"}}>{course.name}</div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{course.format}</div>
                  {course.gameType==="matchplay"&&<span style={{fontSize:9,background:"rgba(201,168,76,0.15)",border:"1px solid rgba(201,168,76,0.3)",borderRadius:10,padding:"2px 8px",color:gold,letterSpacing:1}}>MATCH PLAY</span>}
                </div>
                {matches[course.id].map((match,mi)=>{
                  const pair=pairings[course.id][mi];
                  const t1n=pair.t1.map(i=>{const p=players.team1[i];return p?`${p.name}${p.handicap?` (${p.handicap})`:""}`:"?";}).join(" & ");
                  const t2n=pair.t2.map(i=>{const p=players.team2[i];return p?`${p.name}${p.handicap?` (${p.handicap})`:""}`:"?";}).join(" & ");
                  return (
                    <div key={mi} style={{background:"rgba(0,0,0,0.2)",borderRadius:8,padding:14,marginBottom:10}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:4}}>
                        <div style={{fontSize:12}}><span style={{color:"#4ade80"}}>{t1n}</span><span style={{color:"rgba(255,255,255,0.3)",margin:"0 6px"}}>vs</span><span style={{color:"#f87171"}}>{t2n}</span></div>
                        <div style={{fontSize:11,color:gold}}>Match {mi+1}</div>
                      </div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                        {[{v:"team1",l:`${teamNames.team1} Win`,bg:"#1A5C38",abg:"#2d8a56"},{v:"half",l:"Halved ½",bg:"#7a6020",abg:gold},{v:"team2",l:`${teamNames.team2} Win`,bg:"#7a1a1a",abg:"#cc4444"},{v:null,l:"Pending",bg:"rgba(255,255,255,0.06)",abg:"rgba(255,255,255,0.15)"}].map(btn=>(
                          <button key={String(btn.v)} onClick={()=>setMR(course.id,mi,btn.v)} style={{padding:"7px 10px",border:"none",borderRadius:6,cursor:"pointer",fontFamily:"Georgia,serif",background:match.result===btn.v?btn.abg:btn.bg,color:"#fff",fontSize:11,outline:match.result===btn.v?"2px solid rgba(255,255,255,0.3)":"none"}}>{btn.l}</button>
                        ))}
                        <button onClick={()=>{setScorecardModal({cId:course.id,mi,t1n,t2n});setScorecardThumb("");setScorecardStatus("idle");setScorecardMsg("");}} style={{padding:"7px 10px",border:"1px dashed rgba(255,255,255,0.2)",borderRadius:6,cursor:"pointer",background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.5)",fontSize:15}}>📷</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* PAIRINGS */}
        {tab==="pairings"&&(
          <div>
            <span style={SH}>MATCH PAIRINGS</span>
            {courses.map(course=>(
              <div key={course.id} style={CARD}>
                <div style={{fontSize:10,color:gold,letterSpacing:3,marginBottom:4}}>{course.day} — ROUND {course.id}</div>
                <div style={{fontSize:15,fontWeight:"bold",margin:"4px 0 14px"}}>{course.name}</div>
                {pairings[course.id].map((pair,mi)=>(
                  <div key={mi} style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginBottom:10,background:"rgba(0,0,0,0.2)",borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,color:gold,minWidth:50}}>Match {mi+1}</div>
                    {pair.t1.map((pi,slot)=>(
                      <select key={slot} value={pi} onChange={e=>updPair(course.id,mi,"t1",slot,e.target.value)} style={{background:"rgba(26,92,56,0.55)",border:"1px solid #2d8a56",borderRadius:6,color:"#fff",padding:"6px 8px",fontSize:12,fontFamily:"Georgia,serif"}}>
                        {players.team1.map((p,i)=><option key={i} value={i} style={{background:"#1a3d24"}}>{p.name}{p.handicap?` (${p.handicap})`:""}</option>)}
                      </select>
                    ))}
                    <span style={{color:"rgba(255,255,255,0.3)",fontSize:12}}>vs</span>
                    {pair.t2.map((pi,slot)=>(
                      <select key={slot} value={pi} onChange={e=>updPair(course.id,mi,"t2",slot,e.target.value)} style={{background:"rgba(139,26,26,0.55)",border:"1px solid #cc4444",borderRadius:6,color:"#fff",padding:"6px 8px",fontSize:12,fontFamily:"Georgia,serif"}}>
                        {players.team2.map((p,i)=><option key={i} value={i} style={{background:"#3d1a1a"}}>{p.name}{p.handicap?` (${p.handicap})`:""}</option>)}
                      </select>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* SIDE BETS */}
        {tab==="sidebets"&&(
          <div>
            <span style={SH}>SIDE BETS OVERVIEW</span>
            <div style={{...CARD,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",marginBottom:16,padding:"14px 16px"}}>
              <div style={{fontSize:12,color:"rgba(255,255,255,0.4)",lineHeight:1.7}}>
                Players manage their own bets from their personal view. This tab shows the full settlement summary once results are marked.
              </div>
            </div>
            {bets.length===0&&(
              <div style={{color:"rgba(255,255,255,0.3)",fontSize:13,textAlign:"center",padding:"20px 0"}}>No bets created yet.</div>
            )}
            {transactions.length>0&&(
              <div style={{...CARD,background:"rgba(201,168,76,0.07)",border:"1px solid rgba(201,168,76,0.25)"}}>
                <span style={SH}>💵 WHO OWES WHAT</span>
                {transactions.map((t,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
                    <span style={{fontSize:13}}><span style={{color:"#f87171"}}>{t.from}</span> → <span style={{color:"#4ade80"}}>{t.to}</span></span>
                    <span style={{color:gold,fontWeight:"bold"}}>${t.amount}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={CARD}>
              <span style={SH}>NET BALANCES</span>
              {allPlayers.map(p=>(
                <div key={p.name} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                  <span style={{fontSize:12}}>{p.name}</span>
                  <span style={{fontSize:13,fontWeight:"bold",color:(balances[p.name]||0)>=0?"#4ade80":"#f87171"}}>{(balances[p.name]||0)>=0?"+":""}${(balances[p.name]||0).toFixed(2)}</span>
                </div>
              ))}
            </div>
            {bets.length>0&&(
              <>
                <span style={SH}>ALL BETS ({bets.length})</span>
                {bets.map(bet=>(
                  <div key={bet.id} style={CARD}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                      <div style={{fontSize:14,fontWeight:"bold"}}>{bet.name}</div>
                      <div style={{fontSize:13,color:gold}}>${bet.amount}/person</div>
                    </div>
                    {bet.course&&<div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginBottom:8}}>{bet.course}</div>}
                    <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",marginBottom:6}}>Created by {bet.createdBy||"—"}</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {bet.participants.map(p=>(
                        <div key={p.name} style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:p.side==="winner"?"rgba(74,222,128,0.15)":p.side==="loser"?"rgba(248,113,113,0.1)":"rgba(255,255,255,0.06)",border:`1px solid ${p.side==="winner"?"rgba(74,222,128,0.4)":p.side==="loser"?"rgba(248,113,113,0.3)":"rgba(255,255,255,0.1)"}`,color:p.side==="winner"?"#4ade80":p.side==="loser"?"#f87171":"rgba(255,255,255,0.5)"}}>
                          {p.name}{p.side==="winner"?" ✓":p.side==="loser"?" ✕":p.side==="pending"?" ⏳":""}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* SETUP */}
        {tab==="setup"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <span style={{...SH,marginBottom:0}}>TEAM SETUP</span>
              <button onClick={saveSetup} disabled={!setupDirty} style={{...BTN(setupDirty?gold:"rgba(255,255,255,0.08)",setupDirty?"#1a3d24":"rgba(255,255,255,0.25)"),fontSize:11,padding:"6px 14px"}}>
                {saveStatus==="saved"?"✓ Saved":setupDirty?"Save Changes":"Saved"}
              </button>
            </div>
            {setupDirty&&<div style={{background:"rgba(201,168,76,0.08)",border:"1px solid rgba(201,168,76,0.25)",borderRadius:8,padding:"9px 14px",marginBottom:14,fontSize:11,color:gold}}>⚠ Unsaved changes — tap Save Changes to publish to all players.</div>}

            {/* Team names */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
              {["team1","team2"].map(team=>(
                <div key={team}>
                  <label style={{...LBL,color:team==="team1"?"rgba(74,222,128,0.6)":"rgba(248,113,113,0.6)"}}>TEAM {team==="team1"?"1":"2"} NAME</label>
                  <input value={setupDraft.teamNames[team]} onChange={e=>draftChange({teamNames:{...setupDraft.teamNames,[team]:e.target.value}})} style={IS(team==="team1"?"#2d8a56":"#cc4444")}/>
                </div>
              ))}
            </div>

            {/* Player roster */}
            {(()=>{
              const dp=setupDraft.players;
              const total=(dp.team1?.length||0)+(dp.team2?.length||0)+(dp.pool?.length||0);
              const allRows=[
                ...(dp.pool||[]).map((p,i)=>({p,group:"pool",i})),
                ...(dp.team1||[]).map((p,i)=>({p,group:"team1",i})),
                ...(dp.team2||[]).map((p,i)=>({p,group:"team2",i})),
              ];
              return (
                <div style={{...CARD,marginBottom:20}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <span style={{...SH,marginBottom:0}}>PLAYERS ({total})</span>
                    <div style={{display:"flex",gap:10,fontSize:10,color:"rgba(255,255,255,0.35)"}}>
                      <span style={{color:"rgba(74,222,128,0.7)"}}>T1: {dp.team1?.length||0}</span>
                      <span style={{color:"rgba(248,113,113,0.7)"}}>T2: {dp.team2?.length||0}</span>
                      {(dp.pool?.length||0)>0&&<span>Pool: {dp.pool.length}</span>}
                    </div>
                  </div>

                  {/* Column headers */}
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,paddingBottom:6,borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
                    <div style={{flex:1,fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:2}}>NAME / HCP</div>
                    <div style={{display:"flex",gap:4,fontSize:9,letterSpacing:1}}>
                      <span style={{width:34,textAlign:"center",color:"rgba(255,255,255,0.3)"}}>POOL</span>
                      <span style={{width:34,textAlign:"center",color:"rgba(74,222,128,0.5)"}}>T1</span>
                      <span style={{width:34,textAlign:"center",color:"rgba(248,113,113,0.5)"}}>T2</span>
                    </div>
                    <div style={{width:24}}/>
                  </div>

                  {allRows.length===0&&<div style={{color:"rgba(255,255,255,0.3)",fontSize:13,textAlign:"center",padding:"16px 0"}}>No players yet — tap + Add Player below.</div>}

                  {allRows.map(({p,group,i})=>(
                    <div key={`${group}-${i}`} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <input
                          value={p.name}
                          onChange={e=>updDraftPlayer(group,i,"name",e.target.value)}
                          placeholder="Name"
                          style={{...IS(),fontSize:13,padding:"7px 10px",marginBottom:4}}
                        />
                        <input
                          value={p.handicap}
                          onChange={e=>updDraftPlayer(group,i,"handicap",e.target.value)}
                          onBlur={e=>{const v=parseFloat(e.target.value);if(!isNaN(v))updDraftPlayer(group,i,"handicap",String(Math.round(v)));}}
                          placeholder="HCP"
                          style={{...IS(p.handicap?gold:"rgba(255,255,255,0.1)"),fontSize:12,padding:"5px 10px",color:p.handicap?gold:"#fff"}}
                        />
                      </div>
                      {/* Team assignment strip */}
                      <div style={{display:"flex",gap:4,flexShrink:0}}>
                        {[
                          {g:"pool",  label:"—",  bg:"rgba(255,255,255,0.08)", activeBg:"rgba(255,255,255,0.22)", color:"rgba(255,255,255,0.4)",  activeColor:"#fff"},
                          {g:"team1", label:"T1", bg:"rgba(26,92,56,0.25)",   activeBg:"#2d8a56",               color:"rgba(74,222,128,0.45)",  activeColor:"#fff"},
                          {g:"team2", label:"T2", bg:"rgba(122,26,26,0.25)",  activeBg:"#cc4444",               color:"rgba(248,113,113,0.45)", activeColor:"#fff"},
                        ].map(({g,label,bg,activeBg,color,activeColor})=>(
                          <button
                            key={g}
                            onClick={()=>moveDraftPlayer(group,i,g)}
                            style={{
                              width:34,padding:"6px 2px",border:"none",borderRadius:6,cursor:"pointer",
                              fontFamily:"Georgia,serif",fontSize:10,fontWeight:group===g?"bold":"normal",
                              background:group===g?activeBg:bg,
                              color:group===g?activeColor:color,
                              outline:group===g?"2px solid rgba(255,255,255,0.2)":"none",
                            }}
                          >{label}</button>
                        ))}
                      </div>
                      <button onClick={()=>removeDraftPlayer(group,i)} style={{width:24,height:24,background:"rgba(255,255,255,0.06)",border:"none",color:"rgba(255,255,255,0.25)",borderRadius:4,cursor:"pointer",fontSize:12,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                    </div>
                  ))}

                  <button onClick={()=>{setAddPlayerModal(true);setNewPName("");setNewPHdcp("");setScanThumb("");}} style={{marginTop:14,width:"100%",padding:"10px",background:"rgba(201,168,76,0.07)",border:`1px dashed rgba(201,168,76,0.35)`,color:gold,borderRadius:6,cursor:"pointer",fontFamily:"Georgia,serif",fontSize:13}}>+ Add Player</button>
                </div>
              );
            })()}
            {/* Rules */}
            <div style={{...CARD,background:"rgba(201,168,76,0.06)",border:"1px solid rgba(201,168,76,0.2)",marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <span style={{...SH,marginBottom:0}}>⚙️ SCORING RULES</span>
                <button onClick={()=>draftChange({rules:[...setupDraft.rules,"New rule"]})} style={{...BTN("rgba(201,168,76,0.15)"),padding:"5px 12px",color:gold,fontSize:12}}>+ Add</button>
              </div>
              {setupDraft.rules.map((rule,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:7}}>
                  {editRuleIdx===i
                    ?<><input value={editRuleTxt} onChange={e=>setEditRuleTxt(e.target.value)} style={{...IS(),flex:1,fontSize:12}} autoFocus onKeyDown={e=>{if(e.key==="Enter"){const r=[...setupDraft.rules];r[i]=editRuleTxt;draftChange({rules:r});setEditRuleIdx(null);}}}/>
                      <button onClick={()=>{const r=[...setupDraft.rules];r[i]=editRuleTxt;draftChange({rules:r});setEditRuleIdx(null);}} style={{...BTN("#2d8a56"),padding:"5px 9px",fontSize:12}}>✓</button>
                      <button onClick={()=>setEditRuleIdx(null)} style={{...BTN("rgba(255,255,255,0.07)"),padding:"5px 9px",fontSize:12,color:"rgba(255,255,255,0.4)"}}>✕</button></>
                    :<><div style={{flex:1,fontSize:12,color:"rgba(255,255,255,0.7)",lineHeight:1.5}}>• {rule}</div>
                      <button onClick={()=>{setEditRuleIdx(i);setEditRuleTxt(rule);}} style={{...BTN("rgba(255,255,255,0.06)"),padding:"3px 8px",fontSize:11,color:"rgba(255,255,255,0.4)"}}>✎</button>
                      <button onClick={()=>draftChange({rules:setupDraft.rules.filter((_,idx)=>idx!==i)})} style={{...BTN("rgba(255,255,255,0.06)"),padding:"3px 8px",fontSize:11,color:"rgba(255,255,255,0.3)"}}>✕</button></>
                  }
                </div>
              ))}
            </div>
            {/* Courses */}
            <div style={{...CARD,background:"rgba(201,168,76,0.06)",border:"1px solid rgba(201,168,76,0.2)",marginBottom:16,marginTop:4}}>
              <span style={{...SH,marginBottom:12}}>⛳ COURSES & GAME TYPES</span>
              {setupDraft.courseList.map((c,i)=>(
                <div key={c.id} style={{marginBottom:16,paddingBottom:14,borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:2,marginBottom:5}}>ROUND {c.id}</div>
                  <div style={{display:"flex",gap:8,marginBottom:8}}>
                    <input
                      value={c.day}
                      onChange={e=>{const cl=[...setupDraft.courseList];cl[i]={...cl[i],day:e.target.value};draftChange({courseList:cl});}}
                      placeholder="Day label"
                      style={{...IS(),width:90,flex:"0 0 90px",fontSize:12}}
                    />
                    <input
                      value={c.name}
                      onChange={e=>{const cl=[...setupDraft.courseList];cl[i]={...cl[i],name:e.target.value};draftChange({courseList:cl});}}
                      placeholder="Course name"
                      style={{...IS(gold),flex:1,fontSize:12}}
                    />
                  </div>
                  <div>
                    <label style={{...LBL}}>GAME TYPE</label>
                    <select
                      value={c.gameType||"bestball"}
                      onChange={e=>{const cl=[...setupDraft.courseList];cl[i]={...cl[i],gameType:e.target.value};draftChange({courseList:cl});}}
                      style={{...IS(c.gameType==="matchplay"?gold:"rgba(255,255,255,0.15)"),fontSize:13,cursor:"pointer",color:c.gameType==="matchplay"?gold:"#fff"}}
                    >
                      <option value="bestball">Best Ball (Net)</option>
                      <option value="singles">Singles (Net)</option>
                      <option value="matchplay">Match Play</option>
                    </select>
                    {c.gameType==="matchplay"&&<div style={{fontSize:11,color:"rgba(201,168,76,0.7)",marginTop:6}}>⛳ Each hole worth 1 point · Ties = 0 · Most holes wins the match</div>}
                  </div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
              <button onClick={()=>persist({matches:initMatches()})} style={{...BTN("rgba(255,255,255,0.07)"),border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.4)",padding:"10px 20px"}}>Reset All Scores</button>
              {setupDirty&&<button onClick={saveSetup} style={{...BTN(gold,"#1a3d24"),padding:"10px 24px",fontSize:14}}>💾 Save Changes</button>}
            </div>
          </div>
        )}
      </div>

      {/* SCORECARD MODAL */}
      {scorecardModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:200}}>
          <div style={{background:"#152e1d",border:`1px solid ${gold}`,borderRadius:"16px 16px 0 0",padding:24,width:"100%",maxWidth:500}}>
            <div style={{fontSize:14,fontWeight:"bold",color:gold,marginBottom:4}}>📷 SCAN SCORECARD</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.4)",marginBottom:14}}><span style={{color:"#4ade80"}}>{scorecardModal.t1n}</span> vs <span style={{color:"#f87171"}}>{scorecardModal.t2n}</span></div>
            {scorecardStatus!=="done"&&(
              <label style={{display:"block",marginBottom:14,cursor:"pointer"}}>
                <div style={{minHeight:scorecardThumb?"auto":90,border:`2px dashed ${scorecardStatus==="error"?"#f87171":"rgba(255,255,255,0.2)"}`,borderRadius:10,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.2)",overflow:"hidden"}}>
                  {scorecardThumb?<img src={scorecardThumb} alt="sc" style={{width:"100%"}}/>:<><div style={{fontSize:24}}>🏌️</div><div style={{fontSize:12,color:"rgba(255,255,255,0.4)",marginTop:6}}>Tap to upload scorecard</div></>}
                </div>
                <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)scanCard(f,scorecardModal.cId,scorecardModal.mi,scorecardModal.t1n,scorecardModal.t2n);e.target.value="";}}/>
              </label>
            )}
            {scorecardStatus==="loading"&&<div style={{textAlign:"center",padding:"12px 0",color:gold}}>⏳ Reading scorecard...</div>}
            {scorecardStatus==="done"&&<div style={{textAlign:"center",padding:"12px 0"}}><div style={{fontSize:20}}>✅</div><div style={{color:"#4ade80",fontWeight:"bold"}}>Result recorded!</div>{scorecardMsg&&<div style={{color:"rgba(255,255,255,0.5)",fontSize:12,marginTop:6}}>{scorecardMsg}</div>}</div>}
            {scorecardStatus==="error"&&<div style={{background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:8,padding:12,marginBottom:12}}><div style={{color:"#f87171",fontSize:12}}>{scorecardMsg}</div></div>}
            {scorecardStatus!=="done"&&(
              <div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",letterSpacing:2,marginBottom:8,textAlign:"center"}}>OR ENTER MANUALLY</div>
                <div style={{display:"flex",gap:8,marginBottom:10}}>
                  {[{v:"team1",l:`${teamNames.team1} Win`,bg:"#1A5C38"},{v:"half",l:"Halved",bg:"#7a6020"},{v:"team2",l:`${teamNames.team2} Win`,bg:"#7a1a1a"}].map(btn=>(
                    <button key={btn.v} onClick={()=>{setMR(scorecardModal.cId,scorecardModal.mi,btn.v);setScorecardModal(null);}} style={{flex:1,padding:"10px 4px",border:"none",borderRadius:7,cursor:"pointer",background:btn.bg,color:"#fff",fontFamily:"Georgia,serif",fontSize:11}}>{btn.l}</button>
                  ))}
                </div>
                <button onClick={()=>setScorecardModal(null)} style={{...BTN("rgba(255,255,255,0.06)"),width:"100%",padding:11,color:"rgba(255,255,255,0.4)"}}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ADD PLAYER MODAL */}
      {addPlayerModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:200}}>
          <div style={{background:"#152e1d",border:`1px solid ${gold}`,borderRadius:"16px 16px 0 0",padding:24,width:"100%",maxWidth:500}}>
            <div style={{fontSize:14,fontWeight:"bold",color:gold,marginBottom:4}}>ADD PLAYER TO ROSTER</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",marginBottom:18}}>Player will be added unassigned — assign to a team from the roster list.</div>
            <label style={{display:"block",marginBottom:14}}>
              <div style={LBL}>OPTIONAL: CARD PHOTO FOR REFERENCE</div>
              <div style={{minHeight:scanThumb?"auto":52,border:"1px dashed rgba(255,255,255,0.2)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",background:"rgba(0,0,0,0.2)",cursor:"pointer"}}>
                {scanThumb?<img src={scanThumb} alt="card" style={{width:"100%"}}/>:<span style={{fontSize:12,color:"rgba(255,255,255,0.3)"}}>📷 Load card photo</span>}
              </div>
              <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=ev=>setScanThumb(ev.target.result);r.readAsDataURL(f);e.target.value="";}}/>
            </label>
            <div style={{marginBottom:12}}><div style={LBL}>PLAYER NAME</div><input value={newPName} onChange={e=>setNewPName(e.target.value)} placeholder="e.g. Sam White" autoFocus style={{...IS(),fontSize:16,padding:"11px 12px"}}/></div>
            <div style={{marginBottom:20}}><div style={LBL}>HANDICAP INDEX</div><input value={newPHdcp} onChange={e=>setNewPHdcp(e.target.value)} onBlur={e=>{const v=parseFloat(e.target.value);if(!isNaN(v))setNewPHdcp(String(Math.round(v)));}} placeholder="e.g. 20" type="number" style={{...IS(gold),fontSize:22,padding:"11px 12px",color:gold,fontWeight:"bold",textAlign:"center"}}/></div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={addPlayer} disabled={!newPName.trim()} style={{...BTN(newPName.trim()?gold:"rgba(201,168,76,0.2)",newPName.trim()?"#1a3d24":"rgba(255,255,255,0.3)"),flex:1,padding:13,fontSize:15}}>Add Player</button>
              <button onClick={()=>{setAddPlayerModal(null);setScanThumb("");}} style={{...BTN("rgba(255,255,255,0.07)"),padding:"13px 20px",color:"rgba(255,255,255,0.4)"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div style={{textAlign:"center",padding:20,color:"rgba(255,255,255,0.15)",fontSize:11,letterSpacing:2}}>
        PALM SPRINGS RYDER CUP  •  OCTOBER
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState(DEFAULT_STATE);
  const [currentPlayer, setCurrentPlayer] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const s = await storageGet();
        if (s) setState(prev => ({ ...prev, ...s }));
      } catch(e) {}
      try {
        const sp = localStorage.getItem("rydercup-player");
        if (sp) setCurrentPlayer(sp);
      } catch(e) {}
      setLoaded(true);
    }
    load();

    // Real-time subscription — all 12 players see live updates without refresh
    const unsub = storageSubscribe((data) => {
      setState(prev => ({ ...prev, ...data }));
    });
    return () => unsub();
  }, []);

  function selectPlayer(name) {
    setCurrentPlayer(name);
    try { localStorage.setItem("rydercup-player", name); } catch(e) {}
  }
  function switchPlayer() {
    setCurrentPlayer(null);
    try { localStorage.removeItem("rydercup-player"); } catch(e) {}
  }

  if (!loaded) return (
    <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Georgia,serif",color:gold,fontSize:18}}>Loading...</div>
  );

  const allNames = [...state.players.team1, ...state.players.team2].map(p => p.name);
  const valid = currentPlayer === "__captain__" || allNames.includes(currentPlayer);

  if (!currentPlayer || !valid) {
    return <PlayerPicker players={state.players} teamNames={state.teamNames} onSelect={selectPlayer}/>;
  }
  if (currentPlayer === "__captain__") {
    return <CaptainView state={state} setState={setState} onSwitch={switchPlayer}/>;
  }
  return <PlayerView playerName={currentPlayer} state={state} setState={setState} onSwitch={switchPlayer}/>;
}
