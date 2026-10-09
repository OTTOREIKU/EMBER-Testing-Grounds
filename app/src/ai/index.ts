// A computer player: a driver in a seat, a policy for its judgement, a seeded
// generator for its dice and its coin.
export { Driver, type DriverOptions, type Host, type LogEntry, type Step } from './driver';
export { eagerPolicy } from './eager';
export { behindNow, carried, gainOf, holds, marginOf, missionOf, payFrom, secondaryStake, stakesOf, standingFor, swingOf, TACTICIAN, testWorth, tieWorth, unitWorth, zoned, type Weights } from './evaluate';
export { FEATURES, FIRST_READING, featureMap, featuresOf, type Look } from './features';
export { hasModel, judge, judgeFeatures, useModel, type Model, type Tree } from './learned';
export { legalPolicy } from './legal';
export { blundering, RECRUIT_RATE, recruitPolicy, VETERAN_SKILLS, VETERAN_WEIGHTS, veteranPolicy } from './levels';
export { BRAWLER_SKILLS, BRAWLER_WEIGHTS, brawlerPolicy } from './styles';
export { exposureAt, firstAnswers, makeTactician, races, SKILLS, TACTICIAN_LIMITS, tacticianPolicy, DIALS, TIES, turnPlanner, weighed, type DialInfo, type Skills, type TieInfo, type Weighed } from './tactician';
export { chooseDials, likelyTiming, projectRound, ROUND_KILL, roundOrder, type DialOwn, type Planner, type ProjectedRound, type RoundCut, type RoundStep, type SquadChoice, type TurnPlan } from './squad';
export { safePolicy, type Choice, type Policy } from './policy';
export { Rng, seedOf } from './rng';
