FROM node:alpine

# Create app directory
RUN mkdir -p /var/orchid
WORKDIR /var/orchid

# Install app dependencies
COPY package.json /var/orchid
RUN npm install

# Bundle app source
COPY app /var/orchid/app

EXPOSE 8888

CMD ["npm start"]
