FROM python:3.11-slim-buster


WORKDIR /app

RUN apt-get update && apt-get install -y git build-essential ffmpeg libsm6 libxext6

COPY requirements.txt requirements.txt

RUN pip install --no-cache-dir -r requirements.txt

WORKDIR /app/ComfyUI

COPY . .

EXPOSE 8188

CMD ["python", "main.py", "--cpu", "--listen"]
