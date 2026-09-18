"""Turn-based human vs AI session using the same rules as play_game."""

from __future__ import annotations

from typing import Any

from game import (
    DEAL_GRID,
    VERSIONS,
    Version,
    _public_action,
    apply_stayin,
    first_strike_payoff,
    normalize_deal,
    validate_move,
    visible_payoffs,
)

MODELS: dict[str, dict[str, str]] = {
    "deepseek": {
        "id": "deepseek-ai/DeepSeek-V4-Pro-0813",
        "label": "DeepSeek",
        "key_env": "TOGETHER_API_KEY",
    },
    "gpt-5.6": {
        "id": "gpt-5.6",
        "label": "GPT-5.6",
        "key_env": "OPENAI_API_KEY",
    },
}

VERSION_LABELS = {
    "convergent_future": "Convergent · future knowledge",
    "convergent_current": "Convergent · current knowledge",
    "divergent_future": "Divergent · future knowledge",
    "divergent_current": "Divergent · current knowledge",
    "static_future": "Static · future knowledge",
    "static_current": "Static · current knowledge",
    "random": "Random",
    "custom": "Custom",
}

TRAJECTORY_BLURBS = {
    "convergent": "Both players' second-strike penalties shrink toward zero. Lead reaches a positive first strike first.",
    "divergent": "Lead's second-strike penalty improves to zero; Lag's penalty worsens each timestep.",
    "static": "Second-strike penalties stay at −30 for both players.",
}


def version_meta(version: Version) -> dict[str, Any]:
    notes: list[str] = []
    if version.hidden:
        notes.append("Race type is hidden. Only payoffs from the start through the current timestep are visible.")
        blurb = "One of Convergent, Divergent, or Static, chosen at random."
        label = "Random"
        trajectory = "random"
    else:
        if version.info == "future":
            notes.append("Full payoff path is visible.")
        else:
            notes.append("Payoffs from the start through the current timestep are visible.")
        blurb = TRAJECTORY_BLURBS.get(version.trajectory, "Custom second-strike path.")
        label = VERSION_LABELS.get(version.name, version.name)
        trajectory = version.trajectory
    notes.append(
        f"Stay-in bonus: +{version.stayin_bonus} per ending timestep to both players."
    )
    return {
        "name": version.name,
        "label": label,
        "trajectory": trajectory,
        "info": version.info,
        "first_strike_bonus": version.first_strike_bonus,
        "destruction_penalty": version.destruction_penalty,
        "concession_ratio": version.concession_ratio,
        "stayin_bonus": version.stayin_bonus,
        "hidden": version.hidden,
        "blurb": blurb,
        "notes": notes,
    }


def setup_payload() -> dict[str, Any]:
    return {
        "models": [
            {"key": key, "label": spec["label"], "id": spec["id"]}
            for key, spec in MODELS.items()
        ],
        "versions": [version_meta(v) for v in VERSIONS],
        "deal_grid": [list(d) for d in DEAL_GRID],
    }


def _clean_move(move: dict[str, Any]) -> dict[str, Any]:
    return {
        "action": move.get("action"),
        "deal": move.get("deal"),
        "message": move.get("message") or "",
    }


class InteractiveGame:
    def __init__(self, version: Version, human_role: str, model_key: str, ai_act):
        if human_role not in {"lead", "lag"}:
            raise ValueError("human_role must be lead or lag")
        if model_key not in MODELS:
            raise ValueError(f"unknown model: {model_key}")
        self.version = version
        self.human_role = human_role
        self.ai_role = "lag" if human_role == "lead" else "lead"
        self.model_key = model_key
        self.model_label = MODELS[model_key]["label"]
        self.ai_act = ai_act
        self.steps = version.steps
        self.n = len(self.steps)
        self.timestep = 0
        self.public_history: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.phase = "action"
        self.can_counter = True
        self.offered_deal: dict[str, int] | None = None
        self.offered_by: str | None = None
        self.offer_message = ""
        self.negotiation_round = 0
        self._current_deal: tuple[int, int] | None = None
        self._lead_move: dict[str, Any] | None = None
        self._lag_move: dict[str, Any] | None = None
        self._event: dict[str, Any] | None = None
        self.thread: list[dict[str, Any]] = []
        self.result: dict[str, Any] | None = None
        self.prompt = ""

    def _deal_set(self) -> set[tuple[int, int]]:
        return self.version.deal_set

    def _context(self, role: str, **extra: Any) -> dict[str, Any]:
        return {
            "role": role,
            "version": self.version.name,
            "info": self.version.info,
            "stayin_bonus": self.version.stayin_bonus,
            "timestep": self.timestep,
            "n_timesteps": self.n,
            "is_last_timestep": self.timestep == self.n - 1,
            "visible": visible_payoffs(self.version, self.timestep),
            "public_history": list(self.public_history),
            "deal_grid": [list(d) for d in self.version.deal_grid],
            **extra,
        }

    def _label(self, role: str) -> str:
        return "You" if role == self.human_role else self.model_label

    def _finish(
        self,
        lead_score: int,
        lag_score: int,
        outcome: str,
        extra: dict[str, Any] | None = None,
    ) -> None:
        lead_score, lag_score, award = apply_stayin(
            self.version, lead_score, lag_score, self.timestep
        )
        extra = dict(extra or {})
        extra["stayin_award"] = award
        self.phase = "done"
        self.result = {
            "lead": lead_score,
            "lag": lag_score,
            "outcome": outcome,
            "end_timestep": self.timestep,
            **extra,
        }
        you = lead_score if self.human_role == "lead" else lag_score
        them = lag_score if self.human_role == "lead" else lead_score
        self.thread.append(
            {
                "kind": "result",
                "outcome": outcome,
                "lead": lead_score,
                "lag": lag_score,
                "you": you,
                "them": them,
                "text": _outcome_text(outcome, extra),
            }
        )

    def _record_timestep(self, resolution: str, extra: dict[str, Any] | None = None) -> None:
        assert self._lead_move is not None and self._lag_move is not None
        event = self._event or {
            "timestep": self.timestep,
            "visible": visible_payoffs(self.version, self.timestep),
            "actions": {"lead": self._lead_move, "lag": self._lag_move},
            "negotiation": [],
        }
        event["resolution"] = resolution
        self.events.append(event)
        public: dict[str, Any] = {
            "timestep": self.timestep,
            "lead": _public_action(self._lead_move),
            "lag": _public_action(self._lag_move),
            "negotiation": [
                {
                    "round": item["round"],
                    "recipient": item["recipient"],
                    "offered_deal": item["offered_deal"],
                    "offered_by": item["offered_by"],
                    "reply": _public_action(item["reply"]),
                }
                for item in event.get("negotiation") or []
            ],
            "resolution": resolution,
        }
        if extra and extra.get("deal"):
            public["deal"] = extra["deal"]
        self.public_history.append(public)
        self._clear_offer()
        self._lead_move = None
        self._lag_move = None
        self._event = None

    def _clear_offer(self) -> None:
        self.offered_deal = None
        self.offered_by = None
        self.offer_message = ""
        self.negotiation_round = 0
        self.can_counter = True
        self._current_deal = None
        self.prompt = ""

    def _advance_after_pass(self) -> None:
        self._record_timestep("pass")
        self.thread.append(
            {
                "kind": "resolution",
                "text": f"Both players passed at timestep {self.timestep}.",
            }
        )
        if self.timestep == self.n - 1:
            self._finish(0, 0, "status_quo")
            return
        self.timestep += 1
        self.phase = "action"

    def _set_offer(
        self,
        deal: tuple[int, int],
        offered_by: str,
        message: str,
        round_i: int,
    ) -> None:
        self._current_deal = deal
        self.offered_deal = {"lead": deal[0], "lag": deal[1]}
        self.offered_by = offered_by
        self.offer_message = message
        self.negotiation_round = round_i
        self.can_counter = round_i == 0
        recipient = "lag" if offered_by == "lead" else "lead"
        if recipient == self.human_role:
            self.phase = "negotiate"
            if self.can_counter:
                self.prompt = (
                    f"{self._label(offered_by)} offered ({deal[0]}, {deal[1]}). "
                    "You may accept, counter once, or reject."
                )
            else:
                self.prompt = (
                    f"{self._label(offered_by)} countered with ({deal[0]}, {deal[1]}). "
                    "This is the last reply this timestep. Accept or reject."
                )
        else:
            self.phase = "negotiate"

    def _append_offer_thread(self, offered_by: str, deal: tuple[int, int], message: str) -> None:
        self.thread.append(
            {
                "kind": "offer",
                "actor": offered_by,
                "is_you": offered_by == self.human_role,
                "label": self._label(offered_by),
                "deal": {"lead": deal[0], "lag": deal[1]},
                "message": message,
                "timestep": self.timestep,
            }
        )

    def _append_reply_thread(self, role: str, move: dict[str, Any]) -> None:
        self.thread.append(
            {
                "kind": "reply",
                "actor": role,
                "is_you": role == self.human_role,
                "label": self._label(role),
                "action": move.get("action"),
                "deal": move.get("deal"),
                "message": move.get("message") or "",
                "timestep": self.timestep,
            }
        )

    def _ai_negotiate(self) -> None:
        assert self._current_deal is not None and self.offered_by is not None
        recipient = self.ai_role
        reply = self.ai_act(
            "negotiate",
            self._context(
                recipient,
                phase="negotiate",
                offered_deal={"lead": self._current_deal[0], "lag": self._current_deal[1]},
                offered_by=self.offered_by,
                offer_message=self.offer_message,
                negotiation_round=self.negotiation_round,
                can_counter=self.can_counter,
            ),
        )
        self._apply_negotiate(recipient, reply)

    def _apply_negotiate(self, recipient: str, reply: dict[str, Any]) -> None:
        assert self._current_deal is not None and self.offered_by is not None
        assert self._event is not None
        thread_item = {
            "round": self.negotiation_round,
            "recipient": recipient,
            "offered_deal": {"lead": self._current_deal[0], "lag": self._current_deal[1]},
            "offered_by": self.offered_by,
            "reply": reply,
        }
        self._event["negotiation"].append(thread_item)
        self._append_reply_thread(recipient, reply)
        action = reply.get("action")
        if action == "accept":
            deal = {"lead": self._current_deal[0], "lag": self._current_deal[1]}
            self._record_timestep("deal", extra={"deal": deal})
            self._finish(deal["lead"], deal["lag"], "deal", extra={"deal": deal})
            return
        if action == "counter" and self.can_counter:
            new_deal = normalize_deal(reply.get("deal"), self._deal_set())
            if new_deal is None:
                self._record_timestep("negotiation_invalid_counter")
                self.thread.append(
                    {
                        "kind": "resolution",
                        "text": "The counter was not on the allowed grid. The timestep ends as a pass.",
                    }
                )
                self._continue_or_finish()
                return
            offered_by = recipient
            message = reply.get("message") or ""
            self._set_offer(new_deal, offered_by, message, 1)
            if self.offered_by == self.ai_role:
                return
            self._ai_negotiate()
            return
        resolution = "reject" if action == "reject" else "negotiation_ended"
        self._record_timestep(resolution)
        self.thread.append(
            {
                "kind": "resolution",
                "text": (
                    f"{self._label(recipient)} rejected the treaty. "
                    f"Timestep {self.timestep} ends as a pass."
                    if action == "reject"
                    else f"Negotiation ended at timestep {self.timestep}."
                ),
            }
        )
        self._continue_or_finish()

    def _continue_or_finish(self) -> None:
        if self.timestep == self.n - 1:
            self._finish(0, 0, "status_quo")
            return
        self.timestep += 1
        self.phase = "action"
        self.prompt = ""

    def _resolve_actions(self, lead_move: dict[str, Any], lag_move: dict[str, Any]) -> None:
        self._lead_move = lead_move
        self._lag_move = lag_move
        visible = visible_payoffs(self.version, self.timestep)
        self._event = {
            "timestep": self.timestep,
            "visible": visible,
            "actions": {"lead": lead_move, "lag": lag_move},
            "negotiation": [],
        }
        lead_action = lead_move.get("action")
        lag_action = lag_move.get("action")
        lead_pen, lag_pen = self.steps[self.timestep]
        bonus = self.version.first_strike_bonus
        destruction = self.version.destruction_penalty

        if lead_action == "first_strike" or lag_action == "first_strike":
            self.thread.append(
                {
                    "kind": "action",
                    "actor": "lead",
                    "is_you": self.human_role == "lead",
                    "label": self._label("lead"),
                    "action": lead_action,
                    "deal": lead_move.get("deal"),
                    "message": lead_move.get("message") or "",
                    "timestep": self.timestep,
                }
            )
            self.thread.append(
                {
                    "kind": "action",
                    "actor": "lag",
                    "is_you": self.human_role == "lag",
                    "label": self._label("lag"),
                    "action": lag_action,
                    "deal": lag_move.get("deal"),
                    "message": lag_move.get("message") or "",
                    "timestep": self.timestep,
                }
            )
            if lead_action == "first_strike":
                self._record_timestep("first_strike_lead")
                self._finish(
                    first_strike_payoff(bonus, lead_pen),
                    destruction,
                    "first_strike_lead",
                    extra={"striker": "lead"},
                )
                return
            self._record_timestep("first_strike_lag")
            self._finish(
                destruction,
                first_strike_payoff(bonus, lag_pen),
                "first_strike_lag",
                extra={"striker": "lag"},
            )
            return

        lead_deal = (
            normalize_deal(lead_move.get("deal"), self._deal_set())
            if lead_action == "offer_pause"
            else None
        )
        lag_deal = (
            normalize_deal(lag_move.get("deal"), self._deal_set())
            if lag_action == "offer_pause"
            else None
        )
        if lead_action == "offer_pause" and lead_deal is None:
            lead_action = "pass"
        if lag_action == "offer_pause" and lag_deal is None:
            lag_action = "pass"

        if lead_action == "offer_pause" or lag_action == "offer_pause":
            if lead_action == "offer_pause":
                assert lead_deal is not None
                current_deal = lead_deal
                offered_by = "lead"
                offer_message = lead_move.get("message") or ""
            else:
                assert lag_deal is not None
                current_deal = lag_deal
                offered_by = "lag"
                offer_message = lag_move.get("message") or ""
            self._append_offer_thread(offered_by, current_deal, offer_message)
            self._set_offer(current_deal, offered_by, offer_message, 0)
            if self.phase == "negotiate" and self.offered_by == self.human_role:
                self._ai_negotiate()
            return

        self._advance_after_pass()

    def submit(self, raw: dict[str, Any]) -> dict[str, Any]:
        if self.phase == "done":
            raise ValueError("The game is already over.")
        if self.phase == "action":
            move = validate_move("action", raw, deal_set=self._deal_set())
            if move is None:
                raise ValueError("That is not a valid action for this timestep.")
            human_move = _clean_move(move)
            ai_move = _clean_move(
                self.ai_act("action", self._context(self.ai_role, phase="action"))
            )
            if self.human_role == "lead":
                self._resolve_actions(human_move, ai_move)
            else:
                self._resolve_actions(ai_move, human_move)
            return self.snapshot()
        if self.phase != "negotiate":
            raise ValueError("No move is expected right now.")
        move = validate_move(
            "negotiate",
            raw,
            can_counter=self.can_counter,
            deal_set=self._deal_set(),
        )
        if move is None:
            allowed = "accept, counter, or reject" if self.can_counter else "accept or reject"
            raise ValueError(f"That is not a valid reply. You may {allowed}.")
        self._apply_negotiate(self.human_role, _clean_move(move))
        return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        visible = visible_payoffs(self.version, min(self.timestep, self.n - 1))
        you_score = None
        them_score = None
        if self.result:
            you_score = self.result["lead"] if self.human_role == "lead" else self.result["lag"]
            them_score = self.result["lag"] if self.human_role == "lead" else self.result["lead"]
        return {
            "phase": self.phase,
            "human_role": self.human_role,
            "ai_role": self.ai_role,
            "model": self.model_key,
            "model_label": self.model_label,
            "version": version_meta(self.version),
            "timestep": self.timestep,
            "n_timesteps": self.n,
            "last_timestep": self.n - 1,
            "visible": visible,
            "can_counter": self.can_counter,
            "offered_deal": self.offered_deal,
            "offered_by": self.offered_by,
            "offered_by_label": self._label(self.offered_by) if self.offered_by else None,
            "offer_message": self.offer_message,
            "negotiation_round": self.negotiation_round,
            "deal_grid": [list(d) for d in self.version.deal_grid],
            "prompt": self.prompt,
            "thread": list(self.thread),
            "public_history": list(self.public_history),
            "result": self.result,
            "you_score": you_score,
            "them_score": them_score,
        }


def _outcome_text(outcome: str, extra: dict[str, Any] | None) -> str:
    if outcome == "deal":
        deal = (extra or {}).get("deal") or {}
        award = (extra or {}).get("stayin_award") or 0
        text = f"Deal accepted: lead {deal.get('lead')}, lag {deal.get('lag')}."
        if award:
            text += f" Stay-in award +{award} to each player."
        return text
    if outcome == "first_strike_lead":
        return "The lead player conducted a first strike. The game is over."
    if outcome == "first_strike_lag":
        return "The lag player conducted a first strike. The game is over."
    if outcome == "status_quo":
        award = (extra or {}).get("stayin_award") or 0
        if award:
            return (
                "The race ended with both players passing on the last timestep. "
                f"Stay-in award +{award} to each player."
            )
        return "The race ended with both players passing on the last timestep (0, 0)."
    return outcome
