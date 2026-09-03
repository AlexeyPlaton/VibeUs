FROM python:3.12-slim

WORKDIR /app

RUN addgroup --system vibus && adduser --system --group vibus

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/static && chown -R vibus:vibus /app && chmod +x entrypoint.sh

USER vibus

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
