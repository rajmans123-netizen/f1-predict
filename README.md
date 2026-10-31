# F1 Predict · Mexico City GP 2026

Every driver's **optimal lap** and a **predicted finishing order** for the next Formula 1 race, updated after every practice session and qualifying.

**Try it:** https://rajmans123-netizen.github.io/f1-predict/

- **Optimal lap:** a driver's best sector 1 + best sector 2 + best sector 3 in a session, the lap their car has already shown it can do. "Left on the table" is how far their best real lap was from it.
- **Predicted order:** season form, the car's race pace this season (clean race laps, % off the best car), optimal-lap pace, long-run pace and (after qualifying) the grid. Each is turned into a position from real time gaps (not ranks), and a driver who skipped a session (FP1 rookie runs) isn't penalised. Published stages are frozen, so you can always check what we said and when.
- **Tested on the 2026 season** (`backtest.py`, 8 race weekends): after qualifying the blend called the winner in 6 of 8; car race pace helps most before and just after FP1, and once two practice sessions have run the lap times already show the cars.

- **The optimal lap, forecast before a car runs:** Mexico's qualifying optimal lap in 2023, 2024 and 2025, times the 2026 rules factor (measured at 15 tracks raced in both 2025 and 2026, about 3% slower, with this season's upgrade trend), times each driver's 2026 qualifying gap. **The optimal lap page** (`optimal.html`) rides along with it on the real 2025 pole lap's line and speed trace, against whichever drivers you pick.

Replays and every lap of the season: [Pit Wall](https://rajmans123-netizen.github.io/pitwall/).

Data: [OpenF1](https://openf1.org), unofficial, not associated with Formula 1. Built with Claude for [Raj Tries](https://instagram.com/raj_triess).

MIT licensed. F1, FORMULA 1 and related marks are trademarks of Formula One Licensing B.V.; this project is unofficial.
