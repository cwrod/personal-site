"""Two-human session: sealed simultaneous moves, same rules as play_game."""

from __future__ import annotations

from typing import Any

from game import (
    DEAL_GRID,
    LEAD_BONUS,
    TRAJECTORIES,
    VERSIONS,
    VICTIM_SCORE,
    Version,
    _public_action,
    apply_stayin,
    first_strike_payoff,
    normalize_deal,
    validate_move,
    visible_payoffs,
)
from interactive import _clean_move, _outcome_text, version_meta


def play_setup_payload() -> dict[str, Any]:
    return {
        "versions": [version_meta(v) for v in VERSIONS],
        "deal_grid": [list(d) for d in DEAL_GRID],
    }


class TwoPlayerGame:
    def __init__(self, version: Version):
        self.version = version
        self.steps = TRAJECTORIES[version.trajectory]
        self.n = len(self.steps)
        self.timestep = version.start_timestep
        passed = {"action": "pass", "deal": None, "message": ""}
        self.public_history: list[dict[str, Any]] = [
            {
                "timestep": t,
                "lead": passed,
                "lag": passed,
                "negotiation": [],
                "resolution": "pass",
                "preloaded": True,
            }
            for t in range(version.start_timestep)
        ]
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
        self.pending: dict[str, dict[str, Any] | None] = {"lead": None, "lag": None}
        self.thread: list[dict[str, Any]] = []
        self.result: dict[str, Any] | None = None
        if version.start_timestep:
            self.thread.append(
                {
                    "kind": "note",
                    "text": (
                        f"The first {version.start_timestep} timestep(s) already elapsed. "
                        "Both players passed on those turns."
                    ),
                }
            )

    def waiting_for(self) -> list[str]:
        if self.phase == "done":
            return []
        if self.phase == "action":
            return [role for role in ("lead", "lag") if self.pending[role] is None]
        if self.offered_by is None:
            return []
        recipient = "lag" if self.offered_by == "lead" else "lead"
        return [recipient]

    def _role_label(self, role: str | None, viewer: str) -> str | None:
        if role is None:
            return None
        if role == viewer:
            return "You"
        return "Lead" if role == "lead" else "Lag"

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
        self.pending = {"lead": None, "lag": None}
        self.result = {
            "lead": lead_score,
            "lag": lag_score,
            "outcome": outcome,
            "end_timestep": self.timestep,
            **extra,
        }
        self.thread.append(
            {
                "kind": "result",
                "outcome": outcome,
                "lead": lead_score,
                "lag": lag_score,
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
        self.pending = {"lead": None, "lag": None}

    def _clear_offer(self) -> None:
        self.offered_deal = None
        self.offered_by = None
        self.offer_message = ""
        self.negotiation_round = 0
        self.can_counter = True
        self._current_deal = None

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
        self.phase = "negotiate"

    def _append_offer_thread(self, offered_by: str, deal: tuple[int, int], message: str) -> None:
        self.thread.append(
            {
                "kind": "offer",
                "actor": offered_by,
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
                "action": move.get("action"),
                "deal": move.get("deal"),
                "message": move.get("message") or "",
                "timestep": self.timestep,
            }
        )

    def _apply_negotiate(self, recipient: str, reply: dict[str, Any]) -> None:
        assert self._current_deal is not None and self.offered_by is not None
        assert self._event is not None
        self._event["negotiation"].append(
            {
                "round": self.negotiation_round,
                "recipient": recipient,
                "offered_deal": {"lead": self._current_deal[0], "lag": self._current_deal[1]},
                "offered_by": self.offered_by,
                "reply": reply,
            }
        )
        self._append_reply_thread(recipient, reply)
        action = reply.get("action")
        if action == "accept":
            deal = {"lead": self._current_deal[0], "lag": self._current_deal[1]}
            self._record_timestep("deal", extra={"deal": deal})
            self._finish(deal["lead"], deal["lag"], "deal", extra={"deal": deal})
            return
        if action == "counter" and self.can_counter:
            new_deal = normalize_deal(reply.get("deal"))
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
            self._set_offer(new_deal, recipient, reply.get("message") or "", 1)
            return
        resolution = "reject" if action == "reject" else "negotiation_ended"
        self._record_timestep(resolution)
        who = "Lead" if recipient == "lead" else "Lag"
        self.thread.append(
            {
                "kind": "resolution",
                "text": (
                    f"{who} rejected the treaty. Timestep {self.timestep} ends as a pass."
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

        if lead_action == "first_strike" or lag_action == "first_strike":
            for role, move in (("lead", lead_move), ("lag", lag_move)):
                self.thread.append(
                    {
                        "kind": "action",
                        "actor": role,
                        "action": move.get("action"),
                        "deal": move.get("deal"),
                        "message": move.get("message") or "",
                        "timestep": self.timestep,
                    }
                )
            if lead_action == "first_strike":
                self._record_timestep("first_strike_lead")
                self._finish(
                    first_strike_payoff(LEAD_BONUS, lead_pen),
                    VICTIM_SCORE,
                    "first_strike_lead",
                    extra={"striker": "lead"},
                )
                return
            self._record_timestep("first_strike_lag")
            self._finish(
                VICTIM_SCORE,
                first_strike_payoff(self.version.lag_bonus, lag_pen),
                "first_strike_lag",
                extra={"striker": "lag"},
            )
            return

        if not self.version.allow_pause:
            if lead_action == "offer_pause":
                lead_action = "pass"
            if lag_action == "offer_pause":
                lag_action = "pass"

        lead_deal = normalize_deal(lead_move.get("deal")) if lead_action == "offer_pause" else None
        lag_deal = normalize_deal(lag_move.get("deal")) if lag_action == "offer_pause" else None
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
            return

        self._advance_after_pass()

    def submit(self, role: str, raw: dict[str, Any]) -> dict[str, Any]:
        if role not in {"lead", "lag"}:
            raise ValueError("Role must be lead or lag.")
        if self.phase == "done":
            raise ValueError("The game is already over.")
        if self.phase == "action":
            if self.pending[role] is not None:
                raise ValueError("You already locked in this timestep.")
            move = validate_move("action", raw, allow_pause=self.version.allow_pause)
            if move is None:
                raise ValueError("That is not a valid action for this timestep.")
            self.pending[role] = _clean_move(move)
            if self.pending["lead"] and self.pending["lag"]:
                self._resolve_actions(self.pending["lead"], self.pending["lag"])
            return self.snapshot_for(role)
        if self.phase != "negotiate":
            raise ValueError("No move is expected right now.")
        waiting = self.waiting_for()
        if role not in waiting:
            raise ValueError("Waiting for the other player.")
        move = validate_move(
            "negotiate",
            raw,
            allow_pause=self.version.allow_pause,
            can_counter=self.can_counter,
        )
        if move is None:
            allowed = "accept, counter, or reject" if self.can_counter else "accept or reject"
            raise ValueError(f"That is not a valid reply. You may {allowed}.")
        self._apply_negotiate(role, _clean_move(move))
        return self.snapshot_for(role)

    def snapshot_for(self, role: str) -> dict[str, Any]:
        visible = visible_payoffs(self.version, min(self.timestep, self.n - 1))
        waiting = self.waiting_for()
        you_score = None
        them_score = None
        if self.result:
            you_score = self.result["lead"] if role == "lead" else self.result["lag"]
            them_score = self.result["lag"] if role == "lead" else self.result["lead"]
        thread = []
        for item in self.thread:
            view = dict(item)
            actor = view.get("actor")
            if actor:
                view["is_you"] = actor == role
                view["label"] = self._role_label(str(actor), role)
            if view.get("kind") == "result" and self.result:
                view["you"] = you_score
                view["them"] = them_score
            thread.append(view)
        your_move = self.pending[role] if self.phase == "action" else None
        prompt = self._prompt_for(role, waiting)
        return {
            "phase": self.phase,
            "human_role": role,
            "your_role": role,
            "version": version_meta(self.version),
            "timestep": self.timestep,
            "n_timesteps": self.n,
            "last_timestep": self.n - 1,
            "visible": visible,
            "allow_pause": self.version.allow_pause,
            "can_counter": self.can_counter,
            "offered_deal": self.offered_deal,
            "offered_by": self.offered_by,
            "offered_by_label": self._role_label(self.offered_by, role),
            "offer_message": self.offer_message,
            "negotiation_round": self.negotiation_round,
            "deal_grid": [list(d) for d in DEAL_GRID],
            "prompt": prompt,
            "thread": thread,
            "public_history": list(self.public_history),
            "result": self.result,
            "you_score": you_score,
            "them_score": them_score,
            "waiting_for": waiting,
            "your_turn": role in waiting,
            "you_ready": self.phase == "action" and self.pending[role] is not None,
            "opponent_ready": (
                self.phase == "action" and self.pending["lag" if role == "lead" else "lead"] is not None
            ),
            "your_move": your_move,
        }

    def _prompt_for(self, role: str, waiting: list[str]) -> str:
        if self.phase == "done":
            return (self.thread[-1].get("text") if self.thread else "") or "Game over."
        if self.phase == "negotiate" and self.offered_deal and self.offered_by:
            deal = (self.offered_deal["lead"], self.offered_deal["lag"])
            other = self._role_label(self.offered_by, role)
            if role in waiting:
                if self.can_counter:
                    return (
                        f"{other} offered ({deal[0]}, {deal[1]}). "
                        "You may accept, counter once, or reject."
                    )
                return (
                    f"{other} countered with ({deal[0]}, {deal[1]}). "
                    "This is the last reply this timestep. Accept or reject."
                )
            return f"Waiting for {self._role_label(waiting[0], role)} to reply."
        if self.phase == "action":
            if self.pending[role] is not None:
                action = self.pending[role].get("action") if self.pending[role] else "move"
                return f"You locked in {action}. Waiting for the other player."
            return "Choose first strike, offer a pause, or pass. The other player chooses at the same time."
        return ""
