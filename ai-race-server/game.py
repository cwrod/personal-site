"""AI-race game: trajectories, deals, and simultaneous-move resolution."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal

FIRST_STRIKE_BONUS = 5
DESTRUCTION_PENALTY = -100
CONCESSION_RATIO = 5
MAX_NEGOTIATION_ROUNDS = 2

InfoMode = Literal["future", "current"]
Role = Literal["lead", "lag"]
Outcome = Literal["first_strike_lead", "first_strike_lag", "deal", "status_quo"]

TRAJECTORIES: dict[str, list[tuple[int, int]]] = {
    "convergent": [
        (-30, -30),
        (-25, -29),
        (-20, -25),
        (-15, -20),
        (-10, -15),
        (-8, -10),
        (-5, -8),
        (-3, -5),
        (0, -3),
        (0, 0),
    ],
    "divergent": [
        (-30, -30),
        (-25, -35),
        (-20, -40),
        (-15, -45),
        (-10, -50),
        (-8, -55),
        (-5, -60),
        (-3, -65),
        (0, -70),
        (0, -75),
    ],
    "static": [(-30, -30)] * 10,
}

RACE_NAMES = ("convergent", "divergent", "static")


def make_deal_grid(bonus: int = FIRST_STRIKE_BONUS, ratio: int = CONCESSION_RATIO) -> list[tuple[int, int]]:
    deals = [(0, 0)]
    for k in range(1, bonus + 1):
        deals.append((k, -k * ratio))
        deals.append((-k * ratio, k))
    return deals


DEAL_GRID: list[tuple[int, int]] = make_deal_grid()

ACTION_CHOICES = frozenset({"first_strike", "offer_pause", "pass"})
NEGOTIATE_CHOICES = frozenset({"accept", "counter", "reject"})


@dataclass(frozen=True)
class Version:
    name: str
    trajectory: str
    info: InfoMode
    first_strike_bonus: int = FIRST_STRIKE_BONUS
    destruction_penalty: int = DESTRUCTION_PENALTY
    stayin_bonus: int = 1
    concession_ratio: int = CONCESSION_RATIO
    custom_steps: tuple[tuple[int, int], ...] | None = None
    hidden: bool = False

    @property
    def steps(self) -> list[tuple[int, int]]:
        if self.custom_steps is not None:
            return list(self.custom_steps)
        return list(TRAJECTORIES[self.trajectory])

    @property
    def deal_grid(self) -> list[tuple[int, int]]:
        return make_deal_grid(self.first_strike_bonus, self.concession_ratio)

    @property
    def deal_set(self) -> set[tuple[int, int]]:
        return set(self.deal_grid)


VERSIONS: list[Version] = [
    Version("convergent_future", "convergent", "future"),
    Version("convergent_current", "convergent", "current"),
    Version("divergent_future", "divergent", "future"),
    Version("divergent_current", "divergent", "current"),
    Version("static_future", "static", "future"),
    Version("static_current", "static", "current"),
]

CLASSIC_VERSION_NAMES = [v.name for v in VERSIONS]
VERSION_BY_NAME = {v.name: v for v in VERSIONS}

Actor = Callable[[str, dict[str, Any]], dict[str, Any]]


@dataclass
class GameResult:
    lead_score: int
    lag_score: int
    outcome: Outcome
    end_timestep: int
    log: dict[str, Any] = field(default_factory=dict)


def first_strike_payoff(bonus: int, penalty: int) -> int:
    return bonus + penalty


def stayin_award(version: Version, timestep: int) -> int:
    return version.stayin_bonus * timestep


def apply_stayin(
    version: Version, lead_score: int, lag_score: int, timestep: int
) -> tuple[int, int, int]:
    award = stayin_award(version, timestep)
    return lead_score + award, lag_score + award, award


def visible_payoffs(version: Version, timestep: int) -> dict[str, Any]:
    steps = version.steps
    lead_pen, lag_pen = steps[timestep]
    bonus = version.first_strike_bonus
    destruction = version.destruction_penalty
    current = {
        "timestep": timestep,
        "n_timesteps": len(steps),
        "first_strike_bonus": bonus,
        "destruction_penalty": destruction,
        "concession_ratio": version.concession_ratio,
        "stayin_bonus": version.stayin_bonus,
        "stayin_if_end": stayin_award(version, timestep),
        "lead_penalty": lead_pen,
        "lag_penalty": lag_pen,
        "if_lead_strikes": {
            "lead": first_strike_payoff(bonus, lead_pen),
            "lag": destruction,
        },
        "if_lag_strikes": {
            "lead": destruction,
            "lag": first_strike_payoff(bonus, lag_pen),
        },
    }

    def row(i: int, p: tuple[int, int]) -> dict[str, Any]:
        return {
            "timestep": i,
            "lead_penalty": p[0],
            "lag_penalty": p[1],
            "stayin_if_end": stayin_award(version, i),
            "if_lead_strikes": {
                "lead": first_strike_payoff(bonus, p[0]),
                "lag": destruction,
            },
            "if_lag_strikes": {
                "lead": destruction,
                "lag": first_strike_payoff(bonus, p[1]),
            },
        }

    if version.info == "future":
        current["trajectory"] = [row(i, p) for i, p in enumerate(steps)]
    else:
        current["trajectory"] = [row(i, p) for i, p in enumerate(steps[: timestep + 1])]
    return current


def normalize_deal(
    raw: Any, deal_set: set[tuple[int, int]] | None = None
) -> tuple[int, int] | None:
    allowed = deal_set if deal_set is not None else set(DEAL_GRID)
    if raw is None:
        return None
    if isinstance(raw, (list, tuple)) and len(raw) == 2:
        deal = (int(raw[0]), int(raw[1]))
    elif isinstance(raw, dict):
        if "lead" not in raw or "lag" not in raw:
            return None
        deal = (int(raw["lead"]), int(raw["lag"]))
    else:
        return None
    return deal if deal in allowed else None


def _public_action(move: dict[str, Any]) -> dict[str, Any]:
    return {
        "action": move.get("action"),
        "deal": move.get("deal"),
        "message": move.get("message") or "",
    }


def validate_move(
    phase: str,
    parsed: dict[str, Any] | None,
    can_counter: bool = True,
    deal_set: set[tuple[int, int]] | None = None,
) -> dict[str, Any] | None:
    if not parsed:
        return None
    action = parsed.get("action")
    if phase == "negotiate":
        allowed = NEGOTIATE_CHOICES if can_counter else frozenset({"accept", "reject"})
    else:
        allowed = ACTION_CHOICES
    if action not in allowed:
        return None
    allowed_deals = deal_set if deal_set is not None else set(DEAL_GRID)
    deal = None
    if action in {"offer_pause", "counter"}:
        deal = normalize_deal(parsed.get("deal"), allowed_deals)
        if deal is None:
            return None
    elif parsed.get("deal") is not None:
        maybe = normalize_deal(parsed.get("deal"), allowed_deals)
        if maybe is not None and maybe not in allowed_deals:
            return None
        deal = maybe
    return {
        "action": action,
        "deal": {"lead": deal[0], "lag": deal[1]} if deal is not None else None,
        "message": str(parsed.get("message") or ""),
    }


def make_custom_version(
    *,
    steps: list[tuple[int, int]],
    info: InfoMode = "current",
    first_strike_bonus: int = FIRST_STRIKE_BONUS,
    destruction_penalty: int = DESTRUCTION_PENALTY,
    stayin_bonus: int = 1,
    concession_ratio: int = CONCESSION_RATIO,
    name: str = "custom",
    trajectory: str = "custom",
    hidden: bool = False,
) -> Version:
    return Version(
        name=name,
        trajectory=trajectory,
        info=info,
        first_strike_bonus=first_strike_bonus,
        destruction_penalty=destruction_penalty,
        stayin_bonus=stayin_bonus,
        concession_ratio=concession_ratio,
        custom_steps=tuple((int(a), int(b)) for a, b in steps),
        hidden=hidden,
    )


def make_random_version() -> Version:
    import random

    race = random.choice(RACE_NAMES)
    return Version(name="random", trajectory=race, info="current", hidden=True)


def play_game(version: Version, lead_act: Actor, lag_act: Actor) -> GameResult:
    steps = version.steps
    n = len(steps)
    deals = version.deal_set
    bonus = version.first_strike_bonus
    destruction = version.destruction_penalty
    passed = {"action": "pass", "deal": None, "message": ""}
    public_history: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []

    def context(role: Role, timestep: int, **extra: Any) -> dict[str, Any]:
        return {
            "role": role,
            "version": version.name,
            "info": version.info,
            "stayin_bonus": version.stayin_bonus,
            "timestep": timestep,
            "n_timesteps": n,
            "is_last_timestep": timestep == n - 1,
            "visible": visible_payoffs(version, timestep),
            "public_history": list(public_history),
            "deal_grid": [list(d) for d in version.deal_grid],
            **extra,
        }

    def end(
        lead_score: int,
        lag_score: int,
        outcome: Outcome,
        timestep: int,
        *,
        extra: dict[str, Any] | None = None,
    ) -> GameResult:
        lead_score, lag_score, award = apply_stayin(version, lead_score, lag_score, timestep)
        extra = dict(extra or {})
        extra["stayin_award"] = award
        log = {
            "version": version.name,
            "trajectory_name": version.trajectory,
            "information": version.info,
            "first_strike_bonus": bonus,
            "destruction_penalty": destruction,
            "concession_ratio": version.concession_ratio,
            "stayin_bonus": version.stayin_bonus,
            "trajectory": [
                {"timestep": i, "lead_penalty": p[0], "lag_penalty": p[1]}
                for i, p in enumerate(steps)
            ],
            "events": events,
            "result": {
                "lead": lead_score,
                "lag": lag_score,
                "outcome": outcome,
                "end_timestep": timestep,
                **(extra or {}),
            },
        }
        return GameResult(lead_score, lag_score, outcome, timestep, log)

    for t in range(n):
        visible = visible_payoffs(version, t)
        lead_move = lead_act("action", context("lead", t, phase="action"))
        lag_move = lag_act("action", context("lag", t, phase="action"))

        event: dict[str, Any] = {
            "timestep": t,
            "visible": visible,
            "actions": {"lead": lead_move, "lag": lag_move},
            "negotiation": [],
        }

        lead_action = lead_move.get("action")
        lag_action = lag_move.get("action")

        if lead_action == "first_strike" or lag_action == "first_strike":
            lead_pen, lag_pen = steps[t]
            if lead_action == "first_strike":
                event["resolution"] = "first_strike_lead"
                events.append(event)
                public_history.append(
                    {
                        "timestep": t,
                        "lead": _public_action(lead_move),
                        "lag": _public_action(lag_move),
                        "resolution": "first_strike_lead",
                    }
                )
                return end(
                    first_strike_payoff(bonus, lead_pen),
                    destruction,
                    "first_strike_lead",
                    t,
                    extra={"striker": "lead"},
                )
            event["resolution"] = "first_strike_lag"
            events.append(event)
            public_history.append(
                {
                    "timestep": t,
                    "lead": _public_action(lead_move),
                    "lag": _public_action(lag_move),
                    "resolution": "first_strike_lag",
                }
            )
            return end(
                destruction,
                first_strike_payoff(bonus, lag_pen),
                "first_strike_lag",
                t,
                extra={"striker": "lag"},
            )

        lead_deal = (
            normalize_deal(lead_move.get("deal"), deals) if lead_action == "offer_pause" else None
        )
        lag_deal = (
            normalize_deal(lag_move.get("deal"), deals) if lag_action == "offer_pause" else None
        )
        if lead_action == "offer_pause" and lead_deal is None:
            lead_action = "pass"
        if lag_action == "offer_pause" and lag_deal is None:
            lag_action = "pass"

        if lead_action == "offer_pause" or lag_action == "offer_pause":
            if lead_action == "offer_pause":
                current_deal = lead_deal
                offered_by: Role = "lead"
                offer_message = lead_move.get("message") or ""
                recipient: Role = "lag"
            else:
                current_deal = lag_deal
                offered_by = "lag"
                offer_message = lag_move.get("message") or ""
                recipient = "lead"

            for round_i in range(MAX_NEGOTIATION_ROUNDS):
                can_counter = round_i == 0
                actor = lag_act if recipient == "lag" else lead_act
                reply = actor(
                    "negotiate",
                    context(
                        recipient,
                        t,
                        phase="negotiate",
                        offered_deal={"lead": current_deal[0], "lag": current_deal[1]},
                        offered_by=offered_by,
                        offer_message=offer_message,
                        negotiation_round=round_i,
                        can_counter=can_counter,
                    ),
                )
                thread_item = {
                    "round": round_i,
                    "recipient": recipient,
                    "offered_deal": {"lead": current_deal[0], "lag": current_deal[1]},
                    "offered_by": offered_by,
                    "reply": reply,
                }
                event["negotiation"].append(thread_item)

                reply_action = reply.get("action")
                if reply_action == "accept":
                    event["resolution"] = "deal"
                    events.append(event)
                    public_history.append(
                        {
                            "timestep": t,
                            "lead": _public_action(lead_move),
                            "lag": _public_action(lag_move),
                            "resolution": "deal",
                            "deal": {"lead": current_deal[0], "lag": current_deal[1]},
                        }
                    )
                    return end(
                        current_deal[0],
                        current_deal[1],
                        "deal",
                        t,
                        extra={"deal": {"lead": current_deal[0], "lag": current_deal[1]}},
                    )
                if reply_action == "counter" and can_counter:
                    new_deal = normalize_deal(reply.get("deal"), deals)
                    if new_deal is None:
                        event["resolution"] = "negotiation_invalid_counter"
                        break
                    offered_by = recipient
                    recipient = "lead" if recipient == "lag" else "lag"
                    current_deal = new_deal
                    offer_message = reply.get("message") or ""
                    continue
                event["resolution"] = "reject" if reply_action == "reject" else "negotiation_ended"
                break
            else:
                event["resolution"] = "negotiation_cap"
        else:
            event["resolution"] = "pass"

        events.append(event)
        public_history.append(
            {
                "timestep": t,
                "lead": _public_action(lead_move),
                "lag": _public_action(lag_move),
                "negotiation": [
                    {
                        "round": item["round"],
                        "recipient": item["recipient"],
                        "offered_deal": item["offered_deal"],
                        "offered_by": item["offered_by"],
                        "reply": _public_action(item["reply"]),
                    }
                    for item in event["negotiation"]
                ],
                "resolution": event["resolution"],
            }
        )

        if t == n - 1:
            return end(0, 0, "status_quo", t)

    return end(0, 0, "status_quo", n - 1)
