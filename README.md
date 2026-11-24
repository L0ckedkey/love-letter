# Love Letter — self-host

Versi klasik Love Letter (16 kartu, 2–4 pemain) yang bisa dimainkan **offline** di satu perangkat atau **online pakai Game ID**, keduanya dengan bot. Di versi Docker ini mode online tidak butuh login.

## Jalankan

```bash
docker compose up -d --build
```

Buka http://localhost:8080. Ganti port lewat `.env` (salin dari `.env.example`) atau `PORT=9000 docker compose up -d`.

## Main online

1. Buka tab **Online · Game ID**, isi nama, tekan **Buat game baru**.
2. Bagikan Game ID atau tekan **Salin link undangan**.
3. Teman membuka link itu (atau memasukkan ID) dan otomatis duduk di kursi kosong.
4. Host bisa menambah bot / kursi kosong, lalu **Mulai permainan**.

Identitas pemain disimpan per tab browser, jadi refresh aman. Untuk mencoba dua pemain di satu komputer, pakai dua tab atau jendela biasa + incognito.

## Link publik (opsional)

Pakai Cloudflare Quick Tunnel, gratis tanpa akun:

```bash
docker compose --profile tunnel up -d
docker compose logs tunnel | grep trycloudflare
```

Untuk domain sendiri dengan named tunnel, ganti `command` service `tunnel` menjadi `tunnel --no-autoupdate run` dan tambahkan `TUNNEL_TOKEN` di `environment`, lalu arahkan hostname-nya ke `http://app:8080`.

## Data

Game tersimpan di volume `ll-data` (`/data/games.json`) dan bertahan saat restart. Game yang tidak disentuh lebih dari `GAME_TTL_HOURS` jam dihapus otomatis.

```bash
docker compose logs -f app   # log
docker compose down          # stop (data tetap ada)
docker compose down -v       # stop dan hapus semua data game
```

## Catatan

- Tanpa dependency npm; servernya cuma `server.js` (Node 22).
- Status permainan, termasuk kartu tiap pemain, disimpan di server dan dikirim ke semua browser di meja. Layar menyembunyikan kartu lawan, tetapi orang yang membuka developer tools bisa mengintip. Cocok untuk main santai dengan teman.
- Font dimuat dari Google Fonts; tanpa internet halaman tetap jalan dengan font cadangan.
