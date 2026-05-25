import { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth";

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

const STORAGE_KEY = "resumeTailorHistory";
const loadHistory = () => { try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : []; } catch { return []; } };
const saveHistory = (items) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch {} };

const SYSTEM_PROMPT = `You are an elite resume strategist, ATS optimization expert, and professional cover letter writer. Given a master resume and job description, you will produce a tailored resume AND a professional cover letter.

RULES:
1. Never invent skills or experience not in the master resume
2. Mirror exact language and keywords from the JD for ATS
3. Lead bullets with strong action verbs + quantified impact where available
4. Rewrite the professional summary specifically for this role
5. Cover letter must be professional and formal in tone — 3-4 paragraphs
6. Cover letter opening: reference the specific role and company, show genuine interest
7. Cover letter body: connect 2-3 of the candidate's strongest experiences directly to the JD requirements
8. Cover letter closing: confident call to action, express enthusiasm for next steps
9. Cover letter should NOT repeat the resume word for word — it should tell a story

Respond with valid JSON ONLY — no markdown, no backticks, no preamble:
{
  "matchScore": <integer 0-100>,
  "analysis": ["insight 1","insight 2","insight 3","insight 4","insight 5"],
  "keywordsMatched": ["kw1","kw2"],
  "keywordsMissing": ["gap1","gap2"],
  "tailoredResume": "full resume as plain text with \\n for newlines",
  "coverLetter": "full cover letter as plain text with \\n for newlines"
}`;

function computeDiff(original, tailored) {
  const oLines = (original || "").split("\n");
  const nLines = (tailored || "").split("\n");
  const max = Math.max(oLines.length, nLines.length);
  const out = [];
  for (let i = 0; i < max; i++) {
    const o = oLines[i], n = nLines[i];
    if (o === undefined) out.push({ type: "added", text: n });
    else if (n === undefined) out.push({ type: "removed", text: o });
    else if (o === n) out.push({ type: "same", text: n });
    else { out.push({ type: "removed", text: o }); out.push({ type: "added", text: n }); }
  }
  return out;
}

function exportToPDF(content, title) {
  const w = window.open("", "_blank");
  w.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
<style>body{font-family:Georgia,serif;font-size:11pt;line-height:1.65;max-width:800px;margin:40px auto;color:#111;padding:0 40px}pre{white-space:pre-wrap;font-family:inherit}@media print{body{margin:0;padding:20px}}</style>
</head><body><pre>${content.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre>
<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}

async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).href;
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n";
  }
  return text.trim();
}

async function extractTextFromDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

const scoreColor = s => s >= 80 ? "#1a7a3c" : s >= 60 ? "#b07800" : "#c0392b";
const scoreBg = s => s >= 80 ? "#eafaf1" : s >= 60 ? "#fef9e7" : "#fdf0ee";
const S = { INPUT:"input", LOADING:"loading", RESULT:"result", HISTORY:"history" };

// ── File Upload Zone ─────────────────────────────────────────────────────────
function FileUploadZone({ onTextExtracted, currentText, label }) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["pdf","docx","doc","txt"].includes(ext)) {
      setError("Only PDF, DOCX, DOC, or TXT files supported."); return;
    }
    setError(""); setExtracting(true); setFileName(file.name);
    try {
      let text = "";
      if (ext === "pdf") text = await extractTextFromPDF(file);
      else if (ext === "docx" || ext === "doc") text = await extractTextFromDOCX(file);
      else text = await file.text();
      onTextExtracted(text);
    } catch(e) {
      setError("Could not read file — try copying and pasting the text instead.");
      setFileName("");
    } finally { setExtracting(false); }
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleClear = () => { setFileName(""); setError(""); onTextExtracted(""); };

  return (
    <div>
      <div
        onClick={() => !fileName && inputRef.current.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragging ? "#3a6fd8" : fileName ? "#1a7a3c" : "#d0d8f0"}`,
          borderRadius: "8px", padding: "20px", textAlign: "center",
          background: dragging ? "#eef2fb" : fileName ? "#eafaf1" : "#fafbff",
          cursor: fileName ? "default" : "pointer", transition: "all 0.2s",
          marginBottom: "8px"
        }}
      >
        {extracting ? (
          <div style={{color:"#3a6fd8", fontFamily:"monospace", fontSize:"12px"}}>
            <div style={{width:"20px",height:"20px",border:"2px solid #e0e4ef",borderTop:"2px solid #3a6fd8",borderRadius:"50%",margin:"0 auto 8px",animation:"spin 0.9s linear infinite"}}/>
            Extracting text from {fileName}...
          </div>
        ) : fileName ? (
          <div style={{display:"flex", alignItems:"center", justifyContent:"center", gap:"12px"}}>
            <span style={{fontSize:"20px"}}>📄</span>
            <div style={{textAlign:"left"}}>
              <div style={{fontSize:"13px", fontWeight:"600", color:"#1a7a3c"}}>{fileName}</div>
              <div style={{fontSize:"11px", color:"#a0a8c0", fontFamily:"monospace"}}>{currentText.length.toLocaleString()} chars extracted</div>
            </div>
            <button onClick={e=>{e.stopPropagation(); handleClear();}} style={{background:"#fdf0ee", border:"1px solid #f5c0c0", color:"#c0392b", padding:"4px 10px", borderRadius:"4px", fontSize:"11px", cursor:"pointer", fontFamily:"monospace", marginLeft:"8px"}}>✕ Remove</button>
          </div>
        ) : (
          <div>
            <div style={{fontSize:"28px", marginBottom:"8px"}}>📎</div>
            <div style={{fontSize:"13px", fontWeight:"600", color:"#3a6fd8", marginBottom:"4px"}}>Drop your {label} here</div>
            <div style={{fontSize:"11px", color:"#a0a8c0", fontFamily:"monospace"}}>PDF, DOCX, DOC, TXT · or click to browse</div>
          </div>
        )}
      </div>
      {error && <div style={{fontSize:"11px", color:"#c0392b", fontFamily:"monospace", marginBottom:"6px"}}>{error}</div>}
      <input ref={inputRef} type="file" accept=".pdf,.docx,.doc,.txt" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ResumeTailorPro() {
  const [stage, setStage] = useState(S.INPUT);
  const [masterResume, setMasterResume] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("resume");
  const [copied, setCopied] = useState(false);
  const [copiedCL, setCopiedCL] = useState(false);
  const [history, setHistory] = useState([]);
  const [dot, setDot] = useState(0);
  const [step, setStep] = useState(0);
  const [resumeMode, setResumeMode] = useState("paste"); // "paste" | "upload"
  const [jdMode, setJdMode] = useState("paste"); // "paste" | "upload"

  const STEPS = ["Reading job description", "Matching your experience", "Optimizing for ATS", "Writing resume & cover letter"];

  useEffect(() => { setHistory(loadHistory()); }, []);

  useEffect(() => {
    if (stage !== S.LOADING) return;
    const t1 = setInterval(() => setDot(d => (d + 1) % 4), 450);
    const t2 = setInterval(() => setStep(s => Math.min(s + 1, 3)), 1800);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [stage]);

  const handleTailor = async () => {
    if (!masterResume.trim() || !jobDescription.trim()) {
      setError("Please provide both your resume and the job description."); return;
    }
    setError(""); setStage(S.LOADING); setStep(0);
    const msg = `MASTER RESUME:\n${masterResume}\n\n---\n\nJOB TITLE: ${jobTitle||"Not specified"}\nCOMPANY: ${company||"Not specified"}\nJOB DESCRIPTION:\n${jobDescription}\n\nReturn JSON only.`;
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({ model:"claude-sonnet-4-5", max_tokens:4000, system:SYSTEM_PROMPT, messages:[{role:"user",content:msg}] })
      });
      const data = await resp.json();
      const raw = data.content?.map(b=>b.text||"").join("")||"{}";
      const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
      setResult(parsed);
      setActiveTab("resume");
      const entry = { id:Date.now(), date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}), jobTitle:jobTitle||"Untitled Role", company:company||"", matchScore:parsed.matchScore, tailoredResume:parsed.tailoredResume, coverLetter:parsed.coverLetter, analysis:parsed.analysis, keywordsMatched:parsed.keywordsMatched, keywordsMissing:parsed.keywordsMissing, originalResume:masterResume };
      const updated = [entry,...history].slice(0,20);
      setHistory(updated); saveHistory(updated);
      setStage(S.RESULT);
    } catch(e) {
      setError("Something went wrong — please try again."); setStage(S.INPUT);
    }
  };

  const handleCopy = () => { navigator.clipboard.writeText(result?.tailoredResume||""); setCopied(true); setTimeout(()=>setCopied(false),2000); };
  const handleCopyCL = () => { navigator.clipboard.writeText(result?.coverLetter||""); setCopiedCL(true); setTimeout(()=>setCopiedCL(false),2000); };
  const handleReset = () => { setStage(S.INPUT); setResult(null); setError(""); setJobTitle(""); setJobDescription(""); setCompany(""); setMasterResume(""); setResumeMode("paste"); setJdMode("paste"); };
  const loadFromHistory = e => { setResult(e); setJobTitle(e.jobTitle); setCompany(e.company||""); setMasterResume(e.originalResume||""); setStage(S.RESULT); setActiveTab("resume"); };
  const diffLines = result ? computeDiff(masterResume, result.tailoredResume) : [];

  const ModeToggle = ({ mode, setMode }) => (
    <div style={{display:"flex", background:"#f0f2f8", borderRadius:"6px", padding:"2px", gap:"2px", marginBottom:"8px", width:"fit-content"}}>
      {[["paste","✏ Paste"],["upload","📎 Upload"]].map(([m,label])=>(
        <button key={m} onClick={()=>setMode(m)} style={{background:mode===m?"#ffffff":"transparent", border:"none", padding:"5px 14px", fontSize:"11px", fontFamily:"monospace", color:mode===m?"#3a6fd8":"#a0a8c0", cursor:"pointer", borderRadius:"4px", fontWeight:mode===m?"600":"400", transition:"all 0.15s", boxShadow:mode===m?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{minHeight:"100vh", background:"#f5f6fa", color:"#1a1a2e", fontFamily:"Georgia,serif"}}>
      <nav style={{background:"#ffffff", borderBottom:"1px solid #e0e4ef", padding:"14px 36px", display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
        <div style={{display:"flex", alignItems:"center", gap:"12px"}}>
          <span style={{fontSize:"20px", color:"#3a6fd8"}}>◈</span>
          <span style={{fontSize:"16px", fontWeight:"600", color:"#1a1a2e", letterSpacing:"0.02em"}}>Resume Tailor</span>
          <span style={{fontSize:"9px", fontFamily:"monospace", color:"#a0a8c0", letterSpacing:"0.18em", textTransform:"uppercase", borderLeft:"1px solid #e0e4ef", paddingLeft:"12px"}}>AI AGENT</span>
        </div>
        <div style={{display:"flex", gap:"8px", alignItems:"center"}}>
          {stage === S.RESULT && <button onClick={handleReset} style={navBtn}>← New JD</button>}
          <button onClick={() => setStage(stage === S.HISTORY ? S.INPUT : S.HISTORY)} style={{...navBtn, background: stage===S.HISTORY?"#3a6fd8":"transparent", color: stage===S.HISTORY?"#fff":"#5a6080", borderColor: stage===S.HISTORY?"#3a6fd8":"#d0d4e4"}}>
            ⊞ History {history.length > 0 && <span style={{background:"#3a6fd8", color:"#fff", borderRadius:"10px", padding:"1px 6px", fontSize:"9px", marginLeft:"5px"}}>{history.length}</span>}
          </button>
        </div>
      </nav>

      <div style={{maxWidth:"1140px", margin:"0 auto", padding:"36px 36px 80px"}}>

        {/* INPUT */}
        {stage===S.INPUT&&(
          <div>
            {error&&<div style={{background:"#fff0f0", border:"1px solid #f5c0c0", padding:"11px 16px", borderRadius:"6px", color:"#c0392b", fontSize:"13px", marginBottom:"22px", fontFamily:"monospace"}}>{error}</div>}
            <div style={{textAlign:"center", marginBottom:"32px"}}>
              <h1 style={{fontSize:"28px", fontWeight:"600", color:"#1a1a2e", margin:"0 0 8px"}}>AI Resume Tailor</h1>
              <p style={{fontSize:"14px", color:"#6a7090", margin:0}}>Upload or paste your resume + job description → get a tailored resume <span style={{color:"#3a6fd8", fontWeight:"600"}}>& cover letter</span> in seconds</p>
            </div>

            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"14px", marginBottom:"18px"}}>
              <Fld label="Job Title"><input value={jobTitle} onChange={e=>setJobTitle(e.target.value)} placeholder="e.g. Senior TPM – AWS" style={iSt}/></Fld>
              <Fld label="Company"><input value={company} onChange={e=>setCompany(e.target.value)} placeholder="e.g. Amazon" style={iSt}/></Fld>
            </div>

            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"20px", marginBottom:"28px"}}>
              {/* Resume input */}
              <div>
                <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"8px", flexWrap:"wrap", gap:"8px"}}>
                  <div style={{display:"flex", alignItems:"center", gap:"8px"}}>
                    <span style={{fontSize:"11px", letterSpacing:"0.12em", textTransform:"uppercase", color:"#6a7090", fontFamily:"monospace", fontWeight:"600"}}>Master Resume</span>
                    <span style={{fontSize:"10px", background:"#eef2fb", color:"#3a6fd8", border:"1px solid #c8d8f8", padding:"2px 8px", borderRadius:"10px", fontFamily:"monospace"}}>your full experience</span>
                  </div>
                  <ModeToggle mode={resumeMode} setMode={setResumeMode}/>
                </div>
                {resumeMode==="upload"
                  ? <FileUploadZone label="resume" onTextExtracted={setMasterResume} currentText={masterResume}/>
                  : <><textarea value={masterResume} onChange={e=>setMasterResume(e.target.value)} placeholder={"Paste your complete resume here.\n\nInclude every job, skill, certification,\nand achievement."} style={{...taSt, height:"380px"}}/><Cnt n={masterResume.length}/></>
                }
                {resumeMode==="upload" && masterResume && (
                  <div style={{marginTop:"8px"}}>
                    <div style={{fontSize:"10px", color:"#a0a8c0", fontFamily:"monospace", marginBottom:"4px"}}>EXTRACTED TEXT PREVIEW:</div>
                    <textarea value={masterResume} onChange={e=>setMasterResume(e.target.value)} style={{...taSt, height:"200px", fontSize:"11px"}}/>
                    <Cnt n={masterResume.length}/>
                  </div>
                )}
              </div>

              {/* JD input */}
              <div>
                <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"8px", flexWrap:"wrap", gap:"8px"}}>
                  <div style={{display:"flex", alignItems:"center", gap:"8px"}}>
                    <span style={{fontSize:"11px", letterSpacing:"0.12em", textTransform:"uppercase", color:"#6a7090", fontFamily:"monospace", fontWeight:"600"}}>Job Description</span>
                    <span style={{fontSize:"10px", background:"#eef2fb", color:"#3a6fd8", border:"1px solid #c8d8f8", padding:"2px 8px", borderRadius:"10px", fontFamily:"monospace"}}>full JD preferred</span>
                  </div>
                  <ModeToggle mode={jdMode} setMode={setJdMode}/>
                </div>
                {jdMode==="upload"
                  ? <FileUploadZone label="job description" onTextExtracted={setJobDescription} currentText={jobDescription}/>
                  : <><textarea value={jobDescription} onChange={e=>setJobDescription(e.target.value)} placeholder={"Paste the full job description here.\n\nInclude responsibilities, requirements,\nand nice-to-haves."} style={{...taSt, height:"380px"}}/><Cnt n={jobDescription.length}/></>
                }
                {jdMode==="upload" && jobDescription && (
                  <div style={{marginTop:"8px"}}>
                    <div style={{fontSize:"10px", color:"#a0a8c0", fontFamily:"monospace", marginBottom:"4px"}}>EXTRACTED TEXT PREVIEW:</div>
                    <textarea value={jobDescription} onChange={e=>setJobDescription(e.target.value)} style={{...taSt, height:"200px", fontSize:"11px"}}/>
                    <Cnt n={jobDescription.length}/>
                  </div>
                )}
              </div>
            </div>

            <div style={{textAlign:"center"}}>
              <button onClick={handleTailor} style={primBtn} onMouseOver={e=>e.target.style.background="#2a5fc8"} onMouseOut={e=>e.target.style.background="#3a6fd8"}>
                Tailor Resume + Generate Cover Letter →
              </button>
              <p style={{fontSize:"11px", color:"#a0a8c0", fontFamily:"monospace", marginTop:"10px", letterSpacing:"0.06em"}}>ATS-optimized · keyword-matched · cover letter included · never fabricates</p>
            </div>
          </div>
        )}

        {/* LOADING */}
        {stage===S.LOADING&&(
          <div style={{textAlign:"center", padding:"100px 40px"}}>
            <div style={{width:"52px", height:"52px", border:"3px solid #e0e4ef", borderTop:"3px solid #3a6fd8", borderRadius:"50%", margin:"0 auto 36px", animation:"spin 0.9s linear infinite"}}/>
            <h2 style={{fontSize:"18px", fontWeight:"500", color:"#1a1a2e", marginBottom:"10px"}}>Analyzing & Tailoring{".".repeat(dot)}</h2>
            <p style={{color:"#a0a8c0", fontSize:"13px", marginBottom:"36px"}}>Generating your resume + cover letter — about 30 seconds</p>
            <div style={{display:"flex", justifyContent:"center", gap:"10px", flexWrap:"wrap"}}>
              {STEPS.map((s,i)=>(
                <div key={i} style={{padding:"7px 16px", background: i<=step?"#eef2fb":"#ffffff", border:`1px solid ${i<=step?"#3a6fd8":"#e0e4ef"}`, borderRadius:"20px", fontSize:"12px", color: i<=step?"#3a6fd8":"#c0c8e0", fontFamily:"monospace", transition:"all 0.4s ease"}}>
                  {i<=step?"✓ ":""}{s}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RESULT */}
        {stage===S.RESULT&&result&&(
          <div>
            <div style={{display:"flex", alignItems:"center", gap:"20px", marginBottom:"24px", padding:"18px 24px", background:"#ffffff", border:"1px solid #e0e4ef", borderRadius:"10px", flexWrap:"wrap", boxShadow:"0 2px 8px rgba(0,0,0,0.05)"}}>
              <div style={{textAlign:"center", minWidth:"70px", background:scoreBg(result.matchScore), borderRadius:"8px", padding:"10px 16px"}}>
                <div style={{fontSize:"28px", fontFamily:"monospace", fontWeight:"700", color:scoreColor(result.matchScore), lineHeight:"1"}}>{result.matchScore}</div>
                <div style={{fontSize:"9px", color:scoreColor(result.matchScore), letterSpacing:"0.14em", textTransform:"uppercase", marginTop:"3px"}}>Match</div>
              </div>
              <div style={{flex:1, minWidth:"120px"}}>
                <div style={{height:"6px", background:"#e0e4ef", borderRadius:"3px", overflow:"hidden", marginBottom:"6px"}}>
                  <div style={{height:"100%", width:`${result.matchScore}%`, background:scoreColor(result.matchScore), borderRadius:"3px", transition:"width 1.2s ease"}}/>
                </div>
                <div style={{fontSize:"12px", color:"#6a7090"}}>
                  {jobTitle&&<span style={{fontWeight:"600", color:"#1a1a2e"}}>{jobTitle}</span>}
                  {company&&<span style={{color:"#a0a8c0"}}> @ {company}</span>}
                </div>
              </div>
              <div style={{display:"flex", gap:"8px", flexWrap:"wrap"}}>
                <LBtn onClick={handleCopy} green={copied}>{copied?"✓ Copied":"Copy Resume"}</LBtn>
                <LBtn onClick={handleCopyCL} green={copiedCL}>{copiedCL?"✓ Copied":"Copy Cover Letter"}</LBtn>
                <LBtn onClick={()=>exportToPDF(result.tailoredResume,`Resume – ${jobTitle||"Tailored"}`)}>Export PDF</LBtn>
                <LBtn onClick={handleReset} muted>New JD →</LBtn>
              </div>
            </div>

            <div style={{display:"flex", borderBottom:"2px solid #e0e4ef", marginBottom:"22px", gap:"0", overflowX:"auto"}}>
              {[["resume","◈ Tailored Resume"],["cover","✉ Cover Letter"],["analysis","◆ Analysis"],["diff","⊕ Diff View"],["keywords","⊗ Keywords"]].map(([t,label])=>(
                <button key={t} onClick={()=>setActiveTab(t)} style={{background:"transparent", border:"none", borderBottom:activeTab===t?"2px solid #3a6fd8":"2px solid transparent", color:activeTab===t?"#3a6fd8":"#a0a8c0", padding:"10px 20px", fontSize:"11px", fontFamily:"monospace", letterSpacing:"0.12em", textTransform:"uppercase", cursor:"pointer", marginBottom:"-2px", whiteSpace:"nowrap", fontWeight:activeTab===t?"600":"400"}}>{label}</button>
              ))}
            </div>

            {activeTab==="resume"&&(
              <div>
                <div style={{background:"#ffffff", color:"#111", borderRadius:"8px", padding:"52px 60px", fontFamily:"Georgia,serif", fontSize:"13.5px", lineHeight:"1.8", whiteSpace:"pre-wrap", wordBreak:"break-word", border:"1px solid #e0e4ef", boxShadow:"0 4px 20px rgba(0,0,0,0.06)"}}>{result.tailoredResume}</div>
                <div style={{marginTop:"14px", padding:"12px 16px", background:"#fffbf0", border:"1px solid #f0e0b0", borderRadius:"6px", fontSize:"12px", color:"#7a6000", fontFamily:"monospace"}}>⚠ Review before sending — verify all details are accurate and contact info is current.</div>
              </div>
            )}

            {activeTab==="cover"&&(
              <div>
                <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px", flexWrap:"wrap", gap:"10px"}}>
                  <div>
                    <h3 style={{fontSize:"13px", fontFamily:"monospace", letterSpacing:"0.12em", textTransform:"uppercase", color:"#3a6fd8", margin:"0 0 4px", fontWeight:"600"}}>✉ Cover Letter</h3>
                    <p style={{fontSize:"11px", color:"#a0a8c0", margin:0, fontFamily:"monospace"}}>Professional & formal — tailored to {jobTitle||"this role"}{company?` at ${company}`:""}</p>
                  </div>
                  <div style={{display:"flex", gap:"8px"}}>
                    <LBtn onClick={handleCopyCL} green={copiedCL}>{copiedCL?"✓ Copied":"Copy Letter"}</LBtn>
                    <LBtn onClick={()=>exportToPDF(result.coverLetter,`Cover Letter – ${jobTitle||"Tailored"}`)}>Export PDF</LBtn>
                  </div>
                </div>
                <div style={{background:"#ffffff", color:"#111", borderRadius:"8px", padding:"52px 60px", fontFamily:"Georgia,serif", fontSize:"13.5px", lineHeight:"1.9", whiteSpace:"pre-wrap", wordBreak:"break-word", border:"1px solid #e0e4ef", boxShadow:"0 4px 20px rgba(0,0,0,0.06)"}}>{result.coverLetter}</div>
                <div style={{marginTop:"14px", padding:"12px 16px", background:"#eef2fb", border:"1px solid #c8d8f8", borderRadius:"6px", fontSize:"12px", color:"#2a4a8a", fontFamily:"monospace"}}>💡 Tip: Add your address and date at the top. Personalize the opening if you know the hiring manager's name.</div>
              </div>
            )}

            {activeTab==="analysis"&&(
              <div style={{background:"#ffffff", border:"1px solid #e0e4ef", borderRadius:"8px", padding:"28px 32px", boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
                <h3 style={{fontSize:"11px", fontFamily:"monospace", letterSpacing:"0.18em", textTransform:"uppercase", color:"#3a6fd8", margin:"0 0 20px", fontWeight:"600"}}>Why this resume will land</h3>
                {(result.analysis||[]).map((pt,i)=>(
                  <div key={i} style={{display:"flex", gap:"16px", padding:"14px 0", borderBottom:i<(result.analysis||[]).length-1?"1px solid #f0f2f8":"none"}}>
                    <span style={{color:"#3a6fd8", fontFamily:"monospace", fontSize:"12px", minWidth:"24px", paddingTop:"1px", fontWeight:"700"}}>0{i+1}</span>
                    <p style={{margin:0, fontSize:"14px", lineHeight:"1.7", color:"#3a3d5a"}}>{pt}</p>
                  </div>
                ))}
              </div>
            )}

            {activeTab==="diff"&&(
              <div style={{background:"#ffffff", border:"1px solid #e0e4ef", borderRadius:"8px", padding:"24px 28px", boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
                <p style={{fontFamily:"monospace", fontSize:"11px", color:"#a0a8c0", marginTop:0, marginBottom:"16px"}}>
                  <span style={{color:"#1a7a3c", fontWeight:"700"}}>+</span> Added &nbsp;&nbsp;
                  <span style={{color:"#c0392b", fontWeight:"700"}}>−</span> Removed &nbsp;&nbsp;
                  <span style={{color:"#c0c8e0"}}>·</span> Unchanged
                </p>
                <div style={{fontFamily:"monospace", fontSize:"12px", lineHeight:"1.85", whiteSpace:"pre-wrap", maxHeight:"580px", overflowY:"auto"}}>
                  {diffLines.map((ln,i)=>(
                    <div key={i} style={{color:ln.type==="added"?"#1a7a3c":ln.type==="removed"?"#c0392b":"#c0c8e0", background:ln.type==="added"?"#eafaf1":ln.type==="removed"?"#fdf0ee":"transparent", padding:"1px 10px", borderLeft:`3px solid ${ln.type==="added"?"#1a7a3c":ln.type==="removed"?"#c0392b":"transparent"}`}}>
                      {ln.type==="added"?"+ ":ln.type==="removed"?"- ":"  "}{ln.text||" "}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab==="keywords"&&(
              <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"20px"}}>
                <div style={{background:"#ffffff", border:"1px solid #e0e4ef", borderRadius:"8px", padding:"22px 26px", boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
                  <h3 style={{fontSize:"11px", fontFamily:"monospace", letterSpacing:"0.16em", textTransform:"uppercase", color:"#1a7a3c", margin:"0 0 6px", fontWeight:"600"}}>✓ Keywords Matched ({(result.keywordsMatched||[]).length})</h3>
                  <p style={{fontSize:"11px", color:"#a0a8c0", fontFamily:"monospace", margin:"0 0 14px"}}>These ATS keywords are now in your resume</p>
                  <div style={{display:"flex", flexWrap:"wrap", gap:"7px"}}>
                    {(result.keywordsMatched||[]).map((kw,i)=>(
                      <span key={i} style={{background:"#eafaf1", border:"1px solid #a8dfc0", color:"#1a7a3c", padding:"4px 12px", borderRadius:"20px", fontSize:"11px", fontFamily:"monospace"}}>{kw}</span>
                    ))}
                  </div>
                </div>
                <div style={{background:"#ffffff", border:"1px solid #e0e4ef", borderRadius:"8px", padding:"22px 26px", boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
                  <h3 style={{fontSize:"11px", fontFamily:"monospace", letterSpacing:"0.16em", textTransform:"uppercase", color:"#b07800", margin:"0 0 6px", fontWeight:"600"}}>⚠ Gaps / Missing ({(result.keywordsMissing||[]).length})</h3>
                  <p style={{fontSize:"11px", color:"#a0a8c0", fontFamily:"monospace", margin:"0 0 14px"}}>Consider adding if genuinely applicable</p>
                  <div style={{display:"flex", flexWrap:"wrap", gap:"7px"}}>
                    {(result.keywordsMissing||[]).map((kw,i)=>(
                      <span key={i} style={{background:"#fef9e7", border:"1px solid #f0d080", color:"#b07800", padding:"4px 12px", borderRadius:"20px", fontSize:"11px", fontFamily:"monospace"}}>{kw}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* HISTORY */}
        {stage===S.HISTORY&&(
          <div>
            <h2 style={{fontSize:"18px", fontWeight:"600", color:"#1a1a2e", marginBottom:"6px"}}>Saved Resumes</h2>
            <p style={{fontSize:"13px", color:"#a0a8c0", marginBottom:"24px"}}>{history.length} session{history.length!==1?"s":""} saved</p>
            {history.length===0
              ? <div style={{textAlign:"center", padding:"80px", color:"#c0c8e0", fontFamily:"monospace", fontSize:"13px", background:"#ffffff", borderRadius:"10px", border:"1px solid #e0e4ef"}}>No history yet.</div>
              : <div style={{display:"grid", gap:"10px"}}>
                  {history.map(e=>(
                    <div key={e.id} onClick={()=>loadFromHistory(e)} style={{background:"#ffffff", border:"1px solid #e0e4ef", borderRadius:"8px", padding:"18px 24px", display:"flex", alignItems:"center", gap:"18px", cursor:"pointer", transition:"all 0.2s", boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}
                      onMouseOver={el=>{el.currentTarget.style.borderColor="#3a6fd8"; el.currentTarget.style.boxShadow="0 4px 16px rgba(58,111,216,0.1)";}}
                      onMouseOut={el=>{el.currentTarget.style.borderColor="#e0e4ef"; el.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,0.04)";}}>
                      <div style={{textAlign:"center", minWidth:"56px", background:scoreBg(e.matchScore), borderRadius:"8px", padding:"8px"}}>
                        <div style={{fontSize:"22px", fontFamily:"monospace", fontWeight:"700", color:scoreColor(e.matchScore), lineHeight:"1"}}>{e.matchScore}</div>
                        <div style={{fontSize:"8px", color:scoreColor(e.matchScore), letterSpacing:"0.12em", textTransform:"uppercase", marginTop:"2px"}}>score</div>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:"15px", fontWeight:"600", color:"#1a1a2e", marginBottom:"3px"}}>{e.jobTitle}</div>
                        <div style={{fontSize:"12px", color:"#a0a8c0", fontFamily:"monospace"}}>{e.company&&`${e.company} · `}{e.date}</div>
                      </div>
                      <div style={{display:"flex", alignItems:"center", gap:"8px"}}>
                        {e.coverLetter && <span style={{fontSize:"10px", background:"#eef2fb", color:"#3a6fd8", padding:"3px 8px", borderRadius:"10px", fontFamily:"monospace"}}>✉ CL</span>}
                        <span style={{fontSize:"11px", color:"#3a6fd8", fontFamily:"monospace", fontWeight:"600"}}>Load →</span>
                      </div>
                    </div>
                  ))}
                </div>
            }
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        textarea:focus,input:focus{outline:none !important;border-color:#3a6fd8 !important;box-shadow:0 0 0 3px rgba(58,111,216,0.1) !important}
        textarea::placeholder,input::placeholder{color:#c0c8e0}
        ::-webkit-scrollbar{width:6px}
        ::-webkit-scrollbar-track{background:#f0f2f8}
        ::-webkit-scrollbar-thumb{background:#c0c8e0;border-radius:3px}
        button:hover{opacity:0.9}
      `}</style>
    </div>
  );
}

function Fld({label,badge,children}){
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px"}}>
        <span style={{fontSize:"11px",letterSpacing:"0.12em",textTransform:"uppercase",color:"#6a7090",fontFamily:"monospace",fontWeight:"600"}}>{label}</span>
        {badge&&<span style={{fontSize:"10px",background:"#eef2fb",color:"#3a6fd8",border:"1px solid #c8d8f8",padding:"2px 8px",borderRadius:"10px",fontFamily:"monospace"}}>{badge}</span>}
      </div>
      {children}
    </div>
  );
}

function Cnt({n}){
  return <div style={{textAlign:"right",fontSize:"10px",color:"#c0c8e0",fontFamily:"monospace",marginTop:"5px"}}>{n.toLocaleString()} chars</div>;
}

function LBtn({onClick,children,green,muted}){
  const bg = green?"#1a7a3c":muted?"#f0f2f8":"#3a6fd8";
  const col = muted?"#6a7090":"#ffffff";
  return(
    <button onClick={onClick} style={{background:bg,color:col,border:"none",padding:"8px 18px",fontSize:"11px",fontFamily:"monospace",letterSpacing:"0.1em",cursor:"pointer",borderRadius:"6px",fontWeight:"600",transition:"all 0.2s"}}>
      {children}
    </button>
  );
}

const iSt={width:"100%",background:"#ffffff",border:"1px solid #d0d8f0",color:"#1a1a2e",padding:"10px 14px",fontSize:"14px",fontFamily:"Georgia,serif",borderRadius:"6px",boxSizing:"border-box",transition:"all 0.2s"};
const taSt={width:"100%",background:"#ffffff",border:"1px solid #d0d8f0",color:"#1a1a2e",padding:"14px 16px",fontSize:"12.5px",fontFamily:"monospace",lineHeight:"1.7",resize:"vertical",borderRadius:"6px",boxSizing:"border-box",transition:"all 0.2s"};
const primBtn={background:"#3a6fd8",color:"#ffffff",border:"none",padding:"14px 52px",fontSize:"13px",letterSpacing:"0.14em",textTransform:"uppercase",cursor:"pointer",fontFamily:"monospace",fontWeight:"700",transition:"background 0.2s",borderRadius:"6px",boxShadow:"0 4px 14px rgba(58,111,216,0.3)"};
const navBtn={background:"transparent",border:"1px solid #d0d4e4",color:"#5a6080",padding:"6px 14px",fontSize:"10px",fontFamily:"monospace",letterSpacing:"0.12em",textTransform:"uppercase",cursor:"pointer",borderRadius:"6px"};