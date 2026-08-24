import json
from pathlib import Path

DATASET_PATH = Path(__file__).parent / 'dataset.json'

def load_dataset():
    with open(DATASET_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

if __name__ == '__main__':
    data = load_dataset()
    print(f'Loaded {len(data)} test paragraphs.')
    for item in data:
        print(f" - [{item['id']}] Words: {item['word_count']}, Chars: {item['char_count']} | Category: {item['category']}")
