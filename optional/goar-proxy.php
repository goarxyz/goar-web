<?php
declare(strict_types=1);
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Accept');
header('Access-Control-Max-Age: 86400');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
$raw = isset($_GET['url']) ? $_GET['url'] : '';
if ($raw === '' && !empty($_SERVER['PATH_INFO'])) $raw = ltrim($_SERVER['PATH_INFO'], '/');
if ($raw === '' && $_SERVER['REQUEST_METHOD'] === 'POST') {
  $j = json_decode(file_get_contents('php://input') ?: '', true);
  if (is_array($j) && !empty($j['url'])) $raw = $j['url'];
}
$target = filter_var($raw, FILTER_VALIDATE_URL);
if (!$target || !preg_match('#^https?://#i', $target)) {
  http_response_code(400); header('Content-Type: application/json');
  echo json_encode(['ok'=>false,'error'=>'url required']); exit;
}
$host = parse_url($target, PHP_URL_HOST);
if (!$host || preg_match('/^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0)/i', $host)) {
  http_response_code(403); echo json_encode(['ok'=>false,'error'=>'blocked host']); exit;
}
$ch = curl_init($target);
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
  CURLOPT_MAXREDIRS => 5, CURLOPT_TIMEOUT => 30,
  CURLOPT_CUSTOMREQUEST => $_SERVER['REQUEST_METHOD'],
  CURLOPT_HTTPHEADER => ['Accept: */*','User-Agent: GOAR-Proxy/1'],
]);
if ($_SERVER['REQUEST_METHOD'] === 'POST') curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
$body = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: 'application/octet-stream';
$err = curl_error($ch); curl_close($ch);
if ($body === false) { http_response_code(502); echo json_encode(['ok'=>false,'error'=>$err]); exit; }
http_response_code($code ?: 200); header('Content-Type: '.$ctype); echo $body;
