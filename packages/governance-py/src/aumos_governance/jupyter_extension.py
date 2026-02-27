# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""
Jupyter notebook magic commands for AumOS governance.

Load this extension in a notebook cell::

    %load_ext aumos_governance.jupyter_extension

Then activate governance for the session::

    %governance --trust-level 3 --budget 5.00

Record spending as you make LLM calls::

    %governance_spend 0.05 --tool gpt-4o

Check remaining budget at any time::

    %governance_status

Deactivate at the end of the session::

    %governance_disable

Notes
-----
Trust levels are MANUAL ONLY — this extension enforces a static level for
the notebook session. Budget limits are STATIC — no adaptive reallocation
occurs automatically.
"""
from __future__ import annotations

from IPython.core.magic import Magics, line_magic, magics_class
from IPython.core.magic_arguments import argument, magic_arguments, parse_argstring


@magics_class
class GovernanceMagics(Magics):
    """
    IPython magic commands that enforce AumOS governance in notebook sessions.

    State is local to the class instance, which is bound to the IPython shell
    for the lifetime of the kernel. All governance attributes are deliberately
    simple scalars — no adaptive computation, no behavioral scoring.

    Attributes:
        _trust_level: Statically assigned trust level integer (0-5).
        _budget: Static budget ceiling in USD for this session.
        _spent: Cumulative spend recorded via ``%governance_spend``.
        _active: Whether governance enforcement is currently enabled.
    """

    _trust_level: int = 2
    _budget: float = 10.0
    _spent: float = 0.0
    _active: bool = False

    @line_magic
    @magic_arguments()
    @argument("--trust-level", type=int, default=2, help="Trust level (0-5)")
    @argument("--budget", type=float, default=10.0, help="Session budget in USD")
    def governance(self, line: str) -> None:
        """
        Enable governance for the notebook session.

        Sets a static trust level and budget ceiling. Both values remain
        fixed for the session — there is no automatic adjustment.

        Usage::

            %governance --trust-level 3 --budget 5.00

        Args:
            line: Raw argument string parsed by :mod:`IPython.core.magic_arguments`.
        """
        args = parse_argstring(self.governance, line)

        if not (0 <= args.trust_level <= 5):
            print(f"Error: --trust-level must be between 0 and 5; got {args.trust_level}.")
            return

        if args.budget < 0:
            print(f"Error: --budget must be >= 0; got {args.budget}.")
            return

        self._trust_level = args.trust_level
        self._budget = args.budget
        self._spent = 0.0
        self._active = True
        print(
            f"Governance enabled: trust_level=L{self._trust_level},"
            f" budget=${self._budget:.2f}"
        )

    @line_magic
    def governance_status(self, line: str) -> None:
        """
        Show current governance status for this notebook session.

        Displays active trust level, total budget, amount spent so far,
        and remaining budget.

        Usage::

            %governance_status

        Args:
            line: Unused argument string (required by the IPython magic protocol).
        """
        if not self._active:
            print("Governance: INACTIVE")
            return

        remaining = self._budget - self._spent
        print(f"Trust Level: L{self._trust_level}")
        print(
            f"Budget: ${self._spent:.2f} spent"
            f" / ${self._budget:.2f} limit"
            f" (${remaining:.2f} remaining)"
        )

    @line_magic
    @magic_arguments()
    @argument("amount", type=float, help="Amount to record in USD")
    @argument("--tool", type=str, default="unknown", help="Tool name")
    def governance_spend(self, line: str) -> None:
        """
        Record a governance spend against the session budget.

        The spend is checked against the static budget ceiling before
        recording. If it would cause an overrun the request is denied and
        no state is mutated.

        Usage::

            %governance_spend 0.05 --tool gpt-4o

        Args:
            line: Raw argument string parsed by :mod:`IPython.core.magic_arguments`.
        """
        if not self._active:
            print("Governance is not active. Run %governance first.")
            return

        args = parse_argstring(self.governance_spend, line)

        if args.amount <= 0:
            print(f"Error: amount must be positive; got {args.amount}.")
            return

        projected = self._spent + args.amount
        if projected > self._budget:
            print(
                f"DENIED: Would exceed budget"
                f" (${projected:.2f} > ${self._budget:.2f})"
            )
            return

        self._spent += args.amount
        remaining = self._budget - self._spent
        print(
            f"Recorded: ${args.amount:.2f} for {args.tool}"
            f" (${remaining:.2f} remaining)"
        )

    @line_magic
    def governance_disable(self, line: str) -> None:
        """
        Disable governance enforcement for this notebook session.

        Accumulated spend is preserved so that it can be reviewed after
        disabling, but no further enforcement will occur until
        ``%governance`` is called again.

        Usage::

            %governance_disable

        Args:
            line: Unused argument string (required by the IPython magic protocol).
        """
        was_active = self._active
        self._active = False
        if was_active:
            print(
                f"Governance disabled."
                f" Session total: ${self._spent:.2f} / ${self._budget:.2f}"
            )
        else:
            print("Governance was already inactive.")


def load_ipython_extension(ipython: object) -> None:  # type: ignore[no-untyped-def]
    """
    Load the AumOS governance magic extension into an IPython shell.

    Called automatically by IPython when the user runs::

        %load_ext aumos_governance.jupyter_extension

    Args:
        ipython: The active :class:`IPython.core.interactiveshell.InteractiveShell`
            instance. Typed as ``object`` to avoid a hard dependency on IPython
            in environments where it is not installed.
    """
    ipython.register_magics(GovernanceMagics)  # type: ignore[union-attr]
