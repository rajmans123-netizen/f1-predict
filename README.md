# F1 Predict · Mexico City GP 2026

Every driver's **optimal lap** and a **predicted finishing order** for the next Formula 1 race, updated after every practice session and qualifying.

**Try it:** https://rajmans123-netizen.github.io/f1-predict/

- **Optimal lap:** a driver's best sector 1 + best sector 2 + best sector 3 in a session, the lap their car has already shown it can do. "Left on the table" is how far their best real lap was from it.
- **Predicted order:** season form, optimal-lap pace, long-run race pace and (after qualifying) the grid, each ranked 1–22 and blended.
- **Tested on the 2026 season:** the blend was tuned on 7 race weekends. After qualifying it picks 2 of the 3 podium finishers right ~71% of the time; after practice ~49%. Season form turned out to beat practice pace: practice times are noisy.

- **The optimal lap, forecast before a car runs:** Mexico's qualifying optimal lap in 2023, 2024 and 2025, times the 2026 rules factor (measured at 15 tracks raced in both 2025 and 2026, about 3% slower, with this season's upgrade trend), times each driver's 2026 qualifying gap. **The optimal lap page** (`optimal.html`) rides along with it on the real 2025 pole lap's line and speed trace, against whichever drivers you pick.

Replays and every lap of the season: [Pit Wall](https://rajmans123-netizen.github.io/pitwall/).

Data: [OpenF1](https://openf1.org), unofficial, not associated with Formula 1. Built with Claude for [Raj Tries](https://instagram.com/raj_triess).

MIT licensed. F1, FORMULA 1 and related marks are trademarks of Formula One Licensing B.V.; this project is unofficial.
