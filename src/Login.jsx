import { useState } from 'react'
import { supabase } from './supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [wachtwoord, setWachtwoord] = useState('')
  const [fout, setFout] = useState(null)
  const [laden, setLaden] = useState(false)
  const [modus, setModus] = useState('inloggen')
  const [bevestigd, setBevestigd] = useState(false)

  const handel = async (e) => {
    e.preventDefault()
    setLaden(true)
    setFout(null)
    if (modus === 'inloggen') {
      const { error } = await supabase.auth.signInWithPassword({ email, password: wachtwoord })
      if (error) setFout('E-mailadres of wachtwoord klopt niet.')
    } else {
      const { error } = await supabase.auth.signUp({ email, password: wachtwoord })
      if (error) setFout(error.message)
      else setBevestigd(true)
    }
    setLaden(false)
  }

  return (
    <div style={{ minHeight:'100vh', background:'#f0f4f0', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'system-ui' }}>
      <div style={{ background:'white', borderRadius:16, padding:36, width:'100%', maxWidth:380, boxShadow:'0 4px 24px rgba(0,0,0,.10)' }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ fontSize:48 }}>🥦</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#1b5e20', marginTop:6 }}>Prijsbeheer</div>
          <div style={{ fontSize:13, color:'#888', marginTop:2 }}>Groentewinkel</div>
        </div>
        {bevestigd ? (
          <div style={{ textAlign:'center', color:'#1b5e20' }}>
            <div style={{ fontSize:36, marginBottom:12 }}>✉️</div>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>Check je e-mail!</div>
            <div style={{ fontSize:13, color:'#888' }}>Klik op de bevestigingslink om in te loggen.</div>
          </div>
        ) : (
          <form onSubmit={handel}>
            <div style={{ fontSize:13, color:'#555', marginBottom:6, fontWeight:600 }}>E-mailadres</div>
            <input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="naam@winkel.nl"
              style={{ width:'100%', padding:'11px 14px', borderRadius:8, border:'1.5px solid #ddd', fontSize:15, marginBottom:12, boxSizing:'border-box' }} />
            <div style={{ fontSize:13, color:'#555', marginBottom:6, fontWeight:600 }}>Wachtwoord</div>
            <input type="password" required value={wachtwoord} onChange={e=>setWachtwoord(e.target.value)} placeholder="••••••••"
              style={{ width:'100%', padding:'11px 14px', borderRadius:8, border:'1.5px solid #ddd', fontSize:15, marginBottom:20, boxSizing:'border-box' }} />
            {fout && <div style={{ background:'#ffebee', color:'#c62828', padding:'10px 14px', borderRadius:8, fontSize:13, marginBottom:14 }}>⚠️ {fout}</div>}
            <button type="submit" disabled={laden}
              style={{ width:'100%', padding:12, borderRadius:8, background:laden?'#bbb':'#1b5e20', color:'white', border:'none', fontSize:15, fontWeight:700, cursor:'pointer' }}>
              {laden ? 'Bezig…' : modus==='inloggen' ? 'Inloggen' : 'Account aanmaken'}
            </button>
            <div style={{ textAlign:'center', marginTop:16, fontSize:13, color:'#888' }}>
              {modus==='inloggen'
                ? <><span>Nog geen account? </span><span onClick={()=>setModus('registreren')} style={{ color:'#1b5e20', cursor:'pointer', fontWeight:600 }}>Registreren</span></>
                : <><span>Al een account? </span><span onClick={()=>setModus('inloggen')} style={{ color:'#1b5e20', cursor:'pointer', fontWeight:600 }}>Inloggen</span></>
              }
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
