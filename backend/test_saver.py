from langgraph.checkpoint.sqlite import SqliteSaver
try:
    memory = SqliteSaver.from_conn_string("checkpoints.sqlite")
    memory.setup()
    print("Success")
except Exception as e:
    print(f"Error: {e}")
