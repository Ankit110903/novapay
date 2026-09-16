import os
import unittest
import tempfile
from pathlib import Path
from urllib3._collections import HTTPHeaderDict
from unittest.mock import patch, Mock

os.environ.setdefault('SECRET_KEY', 'test-only-session-key')

from app import create_app
import proxy_server
import monitoring_daemon as daemon


class DeploymentTests(unittest.TestCase):
    def test_route_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'PROXY_STATE_FILE': str(Path(directory) / 'route.json')}):
            proxy_server.persist_active_cloud('azure')
            self.assertEqual(proxy_server.load_active_cloud(), 'azure')

    def test_failed_state_write_keeps_current_route(self):
        with patch.object(proxy_server, 'ACTIVE_CLOUD', 'aws'), patch.dict(os.environ, {'PROXY_CONTROL_TOKEN': 'test-control-token'}), patch.object(proxy_server, 'persist_active_cloud', side_effect=OSError('disk unavailable')):
            response = proxy_server.app.test_client().post('/proxy/update-routing', json={'active': 'azure'}, headers={'Authorization': 'Bearer test-control-token'})
            self.assertEqual(response.status_code, 503)
            self.assertEqual(proxy_server.ACTIVE_CLOUD, 'aws')

    def test_gateway_preserves_multiple_cookies_and_query_values(self):
        upstream = Mock(status_code=200, content=b'ok')
        headers = HTTPHeaderDict()
        headers.add('Set-Cookie', 'session=one; Secure; HttpOnly')
        headers.add('Set-Cookie', 'csrf=two; Secure')
        upstream.raw.headers = headers
        with patch.object(proxy_server.http_session, 'request', return_value=upstream) as send:
            response = proxy_server.app.test_client().get('/login?tag=a&tag=b')
        self.assertEqual(len(response.headers.getlist('Set-Cookie')), 2)
        self.assertEqual(send.call_args.kwargs['params'], [('tag', 'a'), ('tag', 'b')])
        self.assertNotIn('cookies', send.call_args.kwargs)

    def test_failed_probe_does_not_invent_telemetry(self):
        with patch.object(daemon.requests, 'get', return_value=Mock(status_code=503)):
            result = daemon.check_instance_health('https://example.test')
        self.assertIsNone(result['cpu'])
        self.assertIsNone(result['memory'])
        self.assertIsNone(result['sessions'])

    def test_health_fails_when_database_is_unavailable(self):
        app = create_app('production')
        with patch('routes.monitoring_routes.check_db_health', return_value={'status': 'disconnected', 'latency_ms': -1}):
            response = app.test_client().get('/health')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json['status'], 'degraded')

    def test_health_succeeds_with_connected_database(self):
        app = create_app('production')
        with patch('routes.monitoring_routes.check_db_health', return_value={'status': 'connected', 'latency_ms': 1}):
            self.assertEqual(app.test_client().get('/health').status_code, 200)

    def test_control_endpoint_requires_token(self):
        with patch.dict(os.environ, {'PROXY_CONTROL_TOKEN': 'test-control-token'}):
            client = proxy_server.app.test_client()
            self.assertEqual(client.post('/proxy/update-routing', json={'active': 'azure'}).status_code, 401)
            response = client.post('/proxy/update-routing', json={'active': 'azure'}, headers={'Authorization': 'Bearer test-control-token'})
            self.assertEqual(response.json['active_cloud'], 'azure')

    def test_daemon_rejects_degraded_200(self):
        response = Mock(status_code=200)
        response.json.return_value = {'status': 'degraded', 'db': 'disconnected'}
        with patch.object(daemon.requests, 'get', return_value=response):
            self.assertEqual(daemon.check_instance_health('https://example.test')['status'], 'DOWN')

    def test_failed_proxy_update_does_not_report_success(self):
        daemon.current_active = 'aws'
        with patch.object(daemon, 'check_instance_health', return_value={'status': 'UP'}), patch.object(daemon.requests, 'post', return_value=Mock(status_code=503)), patch.object(daemon, 'get_db_connection') as db:
            self.assertFalse(daemon.trigger_failover('aws', 'azure', 'test'))
            self.assertEqual(daemon.current_active, 'aws')
            db.assert_not_called()

    def test_unhealthy_standby_is_not_selected(self):
        daemon.current_active = 'aws'
        with patch.object(daemon, 'check_instance_health', return_value={'status': 'DOWN'}), patch.object(daemon.requests, 'post') as route:
            self.assertFalse(daemon.trigger_failover('aws', 'azure', 'test'))
            route.assert_not_called()


if __name__ == '__main__':
    unittest.main()
