"""Doctor lifecycle checker, exercised against a scripted fake TV client."""
from pathlib import Path

from frameforge.config import Config
from frameforge.doctor import run_doctor


class ScriptedClient:
    """Fake FrameTVClient whose behavior is set per-test via class attrs."""

    connected = True
    art = [{"content_id": "MY_F0001"}]
    fail_thumbnail = False

    def __init__(self, cfg, host):
        self.cfg = cfg
        self.host = host

    def status(self):
        if not type(self).connected:
            return {"host": self.host, "connected": False, "error": "refused"}
        return {"host": self.host, "connected": True, "art_mode": "on"}

    def list_art(self):
        return [dict(i) for i in type(self).art]

    def get_thumbnail(self, cid):
        if type(self).fail_thumbnail:
            raise RuntimeError("thumb timeout")
        return b"\xff\xd8fake"

    def upload_batch(self, library, slug, paths, matte="x", portrait_matte="x"):
        ids = []
        for p in paths:
            cid = f"MY_TEST_{p.stem}"
            library.record_upload(cid, p, slug, "2026-07-01T00:00:00Z")
            ids.append(cid)
        return ids

    def select_art(self, cid):
        pass

    def delete_art(self, cids):
        return list(cids)


def _cfg(tmp_path) -> Config:
    return Config(library_root=tmp_path / "lib", tv_host="192.0.2.9")


def test_doctor_all_steps_pass(tmp_path):
    ScriptedClient.connected = True
    ScriptedClient.art = [{"content_id": "MY_F0001"}]
    ScriptedClient.fail_thumbnail = False
    results = run_doctor(_cfg(tmp_path), client_factory=ScriptedClient, echo=lambda s: None)
    names = [r.name for r in results]
    assert names == [
        "resolve host", "connect + status", "list art", "fetch thumbnail",
        "upload test card", "show test card", "delete test card",
    ]
    assert all(r.ok for r in results)
    # test card temp file cleaned up
    assert not (tmp_path / "lib" / ".doctor_test_card.png").exists()


def test_doctor_no_host_fails_fast(tmp_path):
    cfg = Config(library_root=tmp_path / "lib", tv_host=None)
    results = run_doctor(cfg, client_factory=ScriptedClient, echo=lambda s: None)
    assert len(results) == 1
    assert results[0].name == "resolve host" and not results[0].ok


def test_doctor_status_failure_short_circuits(tmp_path):
    ScriptedClient.connected = False
    results = run_doctor(_cfg(tmp_path), client_factory=ScriptedClient, echo=lambda s: None)
    assert [r.name for r in results] == ["resolve host", "connect + status"]
    assert not results[-1].ok and "refused" in results[-1].detail


def test_doctor_read_only_skips_mutation(tmp_path):
    ScriptedClient.connected = True
    ScriptedClient.art = []
    results = run_doctor(
        _cfg(tmp_path), mutate=False, client_factory=ScriptedClient, echo=lambda s: None
    )
    names = [r.name for r in results]
    assert "upload test card" not in names and "delete test card" not in names
    # empty TV: thumbnail step passes as skipped
    thumb = next(r for r in results if r.name == "fetch thumbnail")
    assert thumb.ok and "skipped" in thumb.detail


def test_doctor_step_failure_recorded_but_continues(tmp_path):
    ScriptedClient.connected = True
    ScriptedClient.art = [{"content_id": "MY_F0001"}]
    ScriptedClient.fail_thumbnail = True
    results = run_doctor(_cfg(tmp_path), client_factory=ScriptedClient, echo=lambda s: None)
    thumb = next(r for r in results if r.name == "fetch thumbnail")
    assert not thumb.ok
    assert any(r.name == "upload test card" for r in results)
