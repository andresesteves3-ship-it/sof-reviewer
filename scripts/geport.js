name: Robô do Geport
on:
  schedule:
    - cron: '37 * * * *'     # a cada hora (minuto 37)
  workflow_dispatch:
permissions:
  contents: write
concurrency:
  group: geport
  cancel-in-progress: false
jobs:
  ler:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install --no-audit --no-fund
      - run: npx playwright install --with-deps chromium
      - run: node scripts/geport.js
        env:
          GEPORT_USER: ${{ secrets.GEPORT_USER }}
          GEPORT_PASS: ${{ secrets.GEPORT_PASS }}
          LINEUP_KEY: ${{ secrets.LINEUP_KEY }}
      - name: Salvar dados
        run: |
          git config user.name "robo-geport"
          git config user.email "robo-geport@users.noreply.github.com"
          git add dados/geport-status.json
          if [ -f dados/geport.enc.json ]; then git add dados/geport.enc.json; fi
          if git diff --cached --quiet; then echo "Nada para salvar"; else
            git commit -m "Geport: atualização automática"
            git pull --rebase origin "${GITHUB_REF_NAME}" || true
            git push
          fi
