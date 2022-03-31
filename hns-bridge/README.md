## HNS-BRIDGE

Origin: [cybrlabs/hns-bridge](https://github.com/cybrlabs/hns-bridge)

## Docker

First, clone [handshake-org/hnsd](https://github.com/handshake-org/hnsd). 
Follow the docker instructions in the readme.md, but use the following create command instead:
```bash
docker create \
  --name=hnsd \
  --publish=127.0.0.1:53:53/udp \
  --publish=127.0.0.1:5369:5369/udp \
  --restart=unless-stopped \
  hnsd -r 0.0.0.0:53
```

Run the hnsd container like you normally would. 
While the node is syncing, clone this repo and edit the config.json to your likings.

Build the image:
```bash
docker build -t hns-bridge .
```

Run the container: 
```bash
docker run -d -p 0.0.0.0:80:80 -t hns-bridge
```

At last, point the ``@`` and ``*`` CNAME records on your domain's nameservers, to your server's IP and enjoy! Have a beautiful time!

#