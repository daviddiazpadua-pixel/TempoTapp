# AI beat tracker benchmark

Eight real recordings from the librosa example corpus, no human annotations, so the comparison is
against known meters/tempos and cross-agreement. TempoTap's classic detector was run with the meter set
to "I'm not sure" so both engines had the same task. 2026-10-18.

| Recording (truth) | Classic detector | BeatNet (AI) | beats within 70 ms |
|---|---|---|---|
| 147793__setuniman__sweet-waltz-0i- (3/4 waltz) | 120 beats, 4/bar, 149.8 BPM (144–172) | 124 beats, 3/bar, 150.0 BPM (143–158) | 100% |
| 442789__lena-orsa__happy-music-pis (2/4 ragtime (piano)) | 170 beats, 4/bar, 143.6 BPM (119–181) | 170 beats, 4/bar, 142.9 BPM (130–158) | 84% |
| Hungarian_Dance_number_5_-_Allegro (2/4, heavy rubato (orch)) | 73 beats, 4/bar, 101.3 BPM (69–172) | 98 beats, 2/bar, 150.0 BPM (75–200) | 48% |
| Kevin_MacLeod_-_P_I_Tchaikovsky_Da (2/4 (orchestra)) | 213 beats, 4/bar, 111.1 BPM (86–157) | 215 beats, 4/bar, 107.1 BPM (97–120) | 42% |
| Kevin_MacLeod_-_Vibe_Ace.ogg (4/4 jazz) | 58 beats, 4/bar, 63.8 BPM (33–75) | 143 beats, 4/bar, 130.4 BPM (125–187) | 86% |
| admiralbob77_-_Choice_-_Drum-bass. (4/4 drum+bass) | 29 beats, 4/bar, 67.6 BPM (66–70) | 57 beats, 2/bar, 136.4 BPM (125–143) | 100% |
| drese-tempo.ogg (trumpet, tempo varies) | 40 beats, 4/bar, 104.4 BPM (88–133) | 37 beats, 2/bar, 81.1 BPM (73–100) | 38% |
| snare-accelerate.ogg (accelerating snare) | 62 beats, 4/bar, 127.6 BPM (70–246) | 65 beats, 3/bar, 120.0 BPM (97–214) | 77% |

Findings: the classic detector reported 4 beats per bar on every file (it does not infer meter) and
locked onto half tempo on the jazz and drum & bass tracks. BeatNet found 3/4 on the waltz and 2/4 on
the Brahms, and never halved. Beat This! (full, 81 MB) agreed with BeatNet on these files; its 8 MB
small variant was weaker — BeatNet's 1.6 MB is the right size for a phone.

Implementation checks: JS features match madmom to 2.7e-7; JS network output matches PyTorch to 8.9e-7;
the JS Viterbi decoder produced identical beat frames to madmom's DBNBeatTrackingProcessor on all eight
recordings (one trailing beat differed on one file).
