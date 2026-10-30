# F1 Predict · who wins the next race

Every driver's **optimal lap** and a **predicted finishing order** for the next Formula 1 race, updated after every practice session and qualifying.

**Try it:** https://rajmans123-netizen.github.io/f1-predict/

- **Optimal lap:** a driver's best sector 1 + best sector 2 + best sector 3 in a session, the lap their car has already shown it can do. "Left on the table" is how far their best real lap was from it.
- **Predicted order:** season form, optimal-lap pace, long-run race pace and (after qualifying) the grid, each ranked 1–22 and blended.
- **Tested on the 2026 season:** the blend was tuned on 7 race weekends. After qualifying it picks 2 of the 3 podium finishers right ~71% of the time; after practice ~49%. Season form turned out to beat practice pace: practice times are noisy.

Replays and every lap of the season: [Pit Wall](https://rajmans123-netizen.github.io/pitwall/).

Data: [OpenF1](https://openf1.org), unofficial, not associated with Formula 1. Built with Claude for [Raj Tries](https://instagram.com/raj_triess).

MIT licensed. F1, FORMULA 1 and related marks are trademarks of Formula One Licensing B.V.; this project is unofficial.
